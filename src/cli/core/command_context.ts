/**
 * command_context.ts — build the `CommandContext` a command's `run` receives.
 *
 * In here: `ContextDeps` (everything that comes from the process, injectable for tests: env,
 * stdio, fetch, sleep, the browser opener) and `makeContext`. The login is resolved only when a
 * command asks for it, so `telenow login` and `--help` work without one; the org id is asked from
 * `GET /api/v1/me` at most once. The client for a saved profile knows the key's expiry, so a 401
 * after it says "this login expired".
 * Not in here: the resolution rules (`resolve_login.ts`), the HTTP client (`api_client.ts`).
 * Called by: `main.ts`.
 */

import { ApiClient, dataOf, type FetchLike } from './api_client.js';
import { CliError, EXIT } from './cli_error.js';
import { userAgent } from './cli_version.js';
import type { CliIo, CommandContext, OptionValues } from './command_spec.js';
import { configPath, readConfig } from './config_store.js';
import type { LoginExpiry } from './login_expiry.js';
import type { OpenUrl } from './open_browser.js';
import { resolveLogin, type ResolvedLogin } from './resolve_login.js';

export interface ContextDeps {
  env: Record<string, string | undefined>;
  io: CliIo;
  cwd: string;
  homedir: string;
  fetch: FetchLike;
  /** Returns early when `signal` fires (Ctrl-C during the browser login). */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  openUrl: OpenUrl;
}

/** How long one request may take before the CLI gives up on it; TELENOW_TIMEOUT_MS overrides. */
const DEFAULT_TIMEOUT_MS = 30_000;

function timeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.TELENOW_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(`TELENOW_TIMEOUT_MS must be a whole number of milliseconds (got '${raw}')`, EXIT.usage);
  }
  return n;
}

export function makeContext(
  parsed: { args: Record<string, string>; values: OptionValues; global: CommandContext['global'] },
  deps: ContextDeps,
  catalog: CommandContext['catalog'],
): CommandContext {
  const file = configPath(deps.env, deps.homedir);
  const build = (baseUrl: string, apiKey: string, expiry?: LoginExpiry) =>
    new ApiClient({
      baseUrl,
      apiKey,
      userAgent: userAgent(),
      timeoutMs: timeoutMs(deps.env),
      fetch: deps.fetch,
      sleep: deps.sleep,
      expiry,
    });
  const apiFor = (baseUrl: string, apiKey: string) => build(baseUrl, apiKey);
  let login: ResolvedLogin | undefined;
  let client: ApiClient | undefined;
  let org: string | undefined;
  const ctx: CommandContext = {
    args: parsed.args,
    values: parsed.values,
    global: parsed.global,
    env: deps.env,
    io: deps.io,
    cwd: deps.cwd,
    configFile: file,
    login() {
      login ??= resolveLogin({ profile: parsed.global.profile, baseUrl: parsed.global.baseUrl }, deps.env, readConfig(file));
      return login;
    },
    api() {
      const l = ctx.login();
      client ??= build(l.baseUrl, l.apiKey, l.expiresAt ? { expiresAt: l.expiresAt, profile: l.profileName } : undefined);
      return client;
    },
    apiFor,
    sleep: deps.sleep,
    openUrl: deps.openUrl,
    async orgId() {
      if (org) return org;
      const saved = ctx.login().orgId;
      if (saved) return (org = saved);
      const me = dataOf((await ctx.api().get('/api/v1/me')).body) as { org_id?: unknown };
      if (typeof me?.org_id !== 'string') {
        throw new CliError('the server did not say which org this key belongs to (GET /api/v1/me)', EXIT.server);
      }
      return (org = me.org_id);
    },
    async orgPath(suffix: string) {
      return `/api/orgs/${encodeURIComponent(await ctx.orgId())}${suffix}`;
    },
    catalog,
  };
  return ctx;
}
