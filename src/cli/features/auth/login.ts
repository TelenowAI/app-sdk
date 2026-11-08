/**
 * login.ts — `telenow login`: sign in with the browser, or save an org API key; check, then save.
 *
 * In here: `loginCommand`. Three ways to a key:
 * - no option: the browser sign-in (`browser_login.ts`), which ends with a NEW org API key made
 *   for this computer. `--no-browser` only prints the link. A server older than browser login
 *   (404) falls back to the key prompt, saying why; with no terminal it says what to do instead.
 * - `--key`: a hidden prompt for a pasted key;
 * - `--key-stdin`: the key read from stdin (scripts, CI).
 * Whichever way, the key is checked with `GET /api/v1/me` and only then saved — with the org it
 * belongs to — as the chosen profile, which becomes the current one. A key the server refuses is
 * never written. The browser login also saves the key's id and expiry (`expiresAt`), and notes
 * on stderr when it expires.
 * Not in here: the device-code flow (`browser_login.ts`), where the file is and how it is
 * written (`core/config_store.ts`), the base-URL rule (`core/resolve_login.ts`).
 * Called by: `features/auth/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, type CommandContext, type CommandSpec } from '../../core/command_spec.js';
import { readConfig, writeConfig, type ConfigFile } from '../../core/config_store.js';
import { expiryNote } from '../../core/login_expiry.js';
import type { CommandOutput } from '../../core/print_output.js';
import { promptHidden, readAllStdin } from '../../core/read_secret.js';
import { checkBaseUrl, DEFAULT_BASE_URL, selectProfileName } from '../../core/resolve_login.js';
import { browserLogin, type MintedKey } from './browser_login.js';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

async function askForKey(ctx: CommandContext, baseUrl: string): Promise<string> {
  if (!ctx.io.stdinIsTTY) {
    throw new CliError(
      'there is no terminal to ask for the key: pipe it in with `--key-stdin`, or set TELENOW_API_KEY',
      EXIT.usage,
    );
  }
  return promptHidden(`API key for ${baseUrl}: `, ctx.io.stdin, ctx.io.stderr);
}

/** Check the key with the server, then save it as profile `name`; `minted` when the browser login made it. */
async function checkAndSave(
  ctx: CommandContext,
  cfg: ConfigFile,
  name: string,
  baseUrl: string,
  rawKey: string,
  minted?: MintedKey,
): Promise<CommandOutput> {
  const key = rawKey.trim();
  if (key.length === 0) throw new CliError('no key was given', EXIT.usage);
  if (/\s/.test(key)) throw new CliError('the key contains spaces or line breaks; paste only the key', EXIT.usage);

  let me: Record<string, unknown> | null;
  try {
    me = dataOf((await ctx.apiFor(baseUrl, key).get('/api/v1/me')).body) as Record<string, unknown> | null;
  } catch (e) {
    // The new key exists on the server now; say which one, so it can be revoked.
    if (minted && e instanceof CliError) {
      throw new CliError(
        `the server made the key ${minted.keyName ? `'${minted.keyName}'` : 'for this login'}, but checking it failed ` +
          `(${e.message}); nothing was saved. Revoke that key in the dashboard and run \`telenow login\` again`,
        e.exitCode,
        { status: e.status, code: e.code, details: { ...e.details, keyId: minted.keyId ?? null } },
      );
    }
    throw e;
  }
  const orgId = str(me?.org_id);
  if (!orgId) throw new CliError('the server did not say which org this key belongs to (GET /api/v1/me)', EXIT.server);

  cfg.profiles[name] = {
    apiKey: key,
    baseUrl,
    orgId,
    orgName: str(me?.org_name),
    keyName: str(me?.key_name),
    keyRole: str(me?.key_role),
    savedAt: new Date().toISOString(),
    ...(minted ? { keyId: minted.keyId, expiresAt: minted.expiresAt } : {}),
  };
  cfg.currentProfile = name;
  writeConfig(ctx.configFile, cfg);
  return {
    data: {
      profile: name,
      current: true,
      baseUrl,
      orgId,
      orgName: str(me?.org_name) ?? null,
      keyName: str(me?.key_name) ?? null,
      keyRole: str(me?.key_role) ?? null,
      configFile: ctx.configFile,
    },
    ...(minted?.expiresAt ? { notes: [expiryNote({ expiresAt: minted.expiresAt, profile: name })] } : {}),
  };
}

export const loginCommand: CommandSpec = {
  path: ['login'],
  summary: 'sign in with the browser, or save an org API key (checked with the server first)',
  options: {
    key: { type: 'boolean', help: 'paste an org API key instead of signing in with the browser' },
    'key-stdin': { type: 'boolean', help: 'read the key from stdin instead of asking (scripts, CI)' },
    'no-browser': { type: 'boolean', help: 'print the sign-in link; do not open a browser (SSH, containers)' },
  },
  async run(ctx) {
    const cfg = readConfig(ctx.configFile);
    const name = selectProfileName({ profile: ctx.global.profile }, ctx.env, cfg);
    const existing = cfg.profiles[name];
    const baseUrl = checkBaseUrl(ctx.global.baseUrl ?? ctx.env.TELENOW_BASE_URL ?? existing?.baseUrl ?? DEFAULT_BASE_URL);

    if (boolOption(ctx.values, 'key-stdin')) {
      return checkAndSave(ctx, cfg, name, baseUrl, await readAllStdin(ctx.io.stdin));
    }
    if (boolOption(ctx.values, 'key')) {
      return checkAndSave(ctx, cfg, name, baseUrl, await askForKey(ctx, baseUrl));
    }
    const minted = await browserLogin(ctx, baseUrl, { openBrowser: !boolOption(ctx.values, 'no-browser') });
    if (minted) return checkAndSave(ctx, cfg, name, baseUrl, minted.apiKey, minted);

    // 404 on /api/cli-login/start: the server is older than browser login.
    const why = `${baseUrl} does not offer browser sign-in yet (the server is older)`;
    if (!ctx.io.stdinIsTTY) {
      throw new CliError(`${why}: pipe an org API key in with \`--key-stdin\`, or set TELENOW_API_KEY`, EXIT.usage, {
        code: 'browser_login_unavailable',
      });
    }
    ctx.io.stderr.write(`${why}; paste an org API key instead.\n`);
    return checkAndSave(ctx, cfg, name, baseUrl, await askForKey(ctx, baseUrl));
  },
};
