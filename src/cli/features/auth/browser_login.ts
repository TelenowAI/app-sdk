/**
 * browser_login.ts — the browser sign-in behind `telenow login` (CLI_BROWSER_LOGIN_PLAN.md §3–§4).
 *
 * In here: `browserLogin` and `MintedKey`. It is the OAuth device grant (RFC 8628):
 * 1. `POST /api/cli-login/start` with `{ hostname, os, cliVersion }` (no key) → a device code, a
 *    user code, the link, `expiresIn` and `interval`.
 * 2. It prints the user code and the link on stderr, and opens the link in the browser — unless
 *    `--no-browser`, or the opener says it cannot (SSH, no display). With no terminal at all (an
 *    AI assistant) the printed link is how the person gets there.
 * 3. It polls `POST /api/cli-login/token` with `{ deviceCode }` every `interval` seconds:
 *    - `authorization_pending`: not decided yet, poll again;
 *    - `slow_down`: 5 seconds more, for this and every later poll (RFC 8628 §3.5);
 *    - `access_denied`, `expired_token`: stop (exit 2);
 *    - a 429 waits out its `Retry-After`; a network error or 5xx is tried again a few times;
 *    - it stops by itself at `expiresIn`, and Ctrl-C stops it at once (exit 1, `cancelled`).
 * It returns the new key and what the server said about it, or `undefined` when the server has
 * no such route (it answers 404: it is older than browser login), so the caller can fall back.
 * The device code is the CLI's secret: it goes only in the token request's BODY — never on
 * stderr, in a URL or in an error. The user code only names the request (the browser page
 * shows it, so the person can check it matches).
 * Not in here: checking and saving the key (`login.ts`), the opener (`core/open_browser.ts`).
 * Called by: `login.ts`.
 */

import { arch, hostname, platform, release } from 'node:os';

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { cliVersion } from '../../core/cli_version.js';
import type { CommandContext } from '../../core/command_spec.js';
import { isLoopbackHost } from '../../core/resolve_login.js';

export interface MintedKey {
  apiKey: string;
  keyId?: string;
  keyName?: string;
  keyRole?: string;
  orgId?: string;
  orgName?: string;
  /** ISO time the key stops working; absent when it does not expire. */
  expiresAt?: string;
}

interface Started {
  deviceCode: string;
  userCode: string;
  link: string;
  expiresInSecs: number;
  intervalSecs: number;
}

/** RFC 8628 §3.2: the interval a client uses when the server names none. */
const DEFAULT_INTERVAL_SECS = 5;
/** RFC 8628 §3.5: how much longer every poll waits after a `slow_down`. */
const SLOW_DOWN_STEP_SECS = 5;
/**
 * How many polls in a row may fail with a network error or a 5xx before the login gives up.
 * Two ride out a deploy restart, as for reads (`api_client.ts`); a server down for longer is
 * reported instead of being waited on in silence until the code expires.
 */
const POLL_RETRIES = 2;
/** A user code is a short name made of letters, digits and dashes (`WDJB-MJHT`). */
const USER_CODE = /^[A-Za-z0-9-]{4,64}$/;

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

function badAnswer(what: string): CliError {
  return new CliError(`the server's answer to POST /api/cli-login/start ${what}`, EXIT.server);
}

/** The link the person opens: http(s) only (plain http only on this computer), never with credentials. */
function checkLink(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  const ok = u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname));
  if (!ok || u.username || u.password) return undefined;
  // `href` is the parsed form: control characters come back percent-encoded, so printing it
  // cannot send escape sequences to the terminal.
  return u.href;
}

function readStart(body: unknown): Started {
  const d = dataOf(body) as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw badAnswer('is not an object');
  const deviceCode = str(d.deviceCode);
  if (!deviceCode) throw badAnswer('has no deviceCode');
  const userCode = str(d.userCode);
  if (!userCode || !USER_CODE.test(userCode)) throw badAnswer('has no usable userCode');
  const link = checkLink(d.verificationUriComplete) ?? checkLink(d.verificationUri);
  if (!link) throw badAnswer('has no https:// verificationUri');
  const expiresInSecs = Number(d.expiresIn);
  if (!Number.isFinite(expiresInSecs) || expiresInSecs <= 0) throw badAnswer('has no positive expiresIn');
  const interval = d.interval === undefined || d.interval === null ? DEFAULT_INTERVAL_SECS : Number(d.interval);
  if (!Number.isFinite(interval) || interval <= 0) throw badAnswer('has an interval that is not a positive number');
  return { deviceCode, userCode, link, expiresInSecs, intervalSecs: interval };
}

function readMinted(body: unknown): MintedKey {
  const d = dataOf(body) as Record<string, unknown> | null;
  const apiKey = str(d?.apiKey);
  if (!apiKey) throw new CliError('the server approved the sign-in but its answer holds no apiKey', EXIT.server);
  return {
    apiKey,
    keyId: str(d?.keyId),
    keyName: str(d?.keyName),
    keyRole: str(d?.keyRole),
    orgId: str(d?.orgId),
    orgName: str(d?.orgName),
    expiresAt: str(d?.expiresAt),
  };
}

function inWords(secs: number): string {
  if (secs < 60) return `${Math.round(secs)} seconds`;
  const min = Math.round(secs / 60);
  return min === 1 ? '1 minute' : `${min} minutes`;
}

/** The token route answers RFC 8628 errors as `{ error: "<code>" }` with 400, which `toCliError` makes the message. */
function rfcError(e: CliError): string | undefined {
  return e.status === 400 ? e.message : undefined;
}

function isTransient(e: CliError): boolean {
  return e.exitCode === EXIT.network || (e.status !== undefined && e.status >= 500);
}

function retryAfterSecs(e: CliError): number | undefined {
  const raw = e.details?.retryAfter;
  const n = typeof raw === 'string' ? Number(raw.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function browserLogin(
  ctx: CommandContext,
  baseUrl: string,
  opts: { openBrowser: boolean },
): Promise<MintedKey | undefined> {
  const anon = ctx.apiFor(baseUrl, '');
  let started: Started;
  try {
    const res = await anon.send('POST', '/api/cli-login/start', {
      body: { hostname: hostname(), os: `${platform()} ${release()} (${arch()})`, cliVersion: cliVersion() },
    });
    started = readStart(res.body);
  } catch (e) {
    if (e instanceof CliError && e.status === 404) return undefined;
    throw e;
  }

  const err = ctx.io.stderr;
  err.write(`To sign in, open this link and approve the code ${started.userCode}:\n  ${started.link}\n`);
  if (opts.openBrowser) {
    const opened = await ctx.openUrl(started.link);
    err.write(
      opened.opened
        ? 'Opened it in your browser; check the page shows the same code.\n'
        : `The link was not opened here (${opened.reason ?? 'no browser'}); open it in a browser on any device.\n`,
    );
  }

  const stop = new AbortController();
  const onSigint = () => stop.abort();
  process.once('SIGINT', onSigint);
  try {
    err.write(`Waiting for approval (the code expires in ${inWords(started.expiresInSecs)}; Ctrl-C cancels)...\n`);
    return await poll(ctx, anon, started, stop.signal);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

async function poll(
  ctx: CommandContext,
  anon: ReturnType<CommandContext['apiFor']>,
  s: Started,
  signal: AbortSignal,
): Promise<MintedKey> {
  const cancelled = () => new CliError('cancelled; nothing was saved', EXIT.usage, { code: 'cancelled' });
  const t0 = Date.now();
  const limitMs = s.expiresInSecs * 1000;
  let intervalSecs = s.intervalSecs;
  let nextWaitSecs = intervalSecs;
  let waitedMs = 0;
  let failuresInARow = 0;
  let answerLost = false;
  for (;;) {
    await ctx.sleep(nextWaitSecs * 1000, signal);
    waitedMs += nextWaitSecs * 1000;
    nextWaitSecs = intervalSecs;
    if (signal.aborted) throw cancelled();
    // Real time in use; the sum of the waits when the clock is a test's.
    if (Math.max(waitedMs, Date.now() - t0) >= limitMs) {
      throw new CliError(
        `the code was not approved within ${inWords(s.expiresInSecs)}; run \`telenow login\` again`,
        EXIT.auth,
        { code: 'expired_token' },
      );
    }
    try {
      const res = await anon.send('POST', '/api/cli-login/token', { body: { deviceCode: s.deviceCode }, signal });
      return readMinted(res.body);
    } catch (e) {
      if (signal.aborted) throw cancelled();
      if (!(e instanceof CliError)) throw e;
      const code = rfcError(e);
      if (code === 'authorization_pending') {
        failuresInARow = 0;
        continue;
      }
      if (code === 'slow_down') {
        failuresInARow = 0;
        intervalSecs += SLOW_DOWN_STEP_SECS;
        nextWaitSecs = intervalSecs;
        continue;
      }
      if (code === 'access_denied') {
        throw new CliError('the sign-in was denied in the browser; nothing was saved', EXIT.auth, { code: 'access_denied' });
      }
      if (code === 'expired_token') {
        throw new CliError(
          answerLost
            ? 'the code is no longer valid: the server may have created the key while its answer was lost. ' +
                'Look for a "telenow CLI" key in the dashboard, revoke it, and run `telenow login` again'
            : 'the code expired or was already used; run `telenow login` again',
          EXIT.auth,
          { code: 'expired_token' },
        );
      }
      if (e.status === 429) {
        const wait = Math.max(intervalSecs, retryAfterSecs(e) ?? intervalSecs);
        if (Math.max(waitedMs, Date.now() - t0) + wait * 1000 >= limitMs) throw e;
        nextWaitSecs = wait;
        continue;
      }
      if (isTransient(e) && failuresInARow < POLL_RETRIES) {
        failuresInARow++;
        answerLost = true;
        continue;
      }
      throw e;
    }
  }
}
