/**
 * resolve_login.ts — which API key, server and profile a command uses.
 *
 * In here: `DEFAULT_BASE_URL`, `isLoopbackHost`, `checkBaseUrl` (https only, except a loopback
 * address; no credentials, query or fragment), `selectProfileName` and `resolveLogin`.
 * Not in here: reading or writing the config file (`config_store.ts`), asking the org id from
 * the server (`command_context.ts`).
 * Called by: `command_context.ts`, the auth commands.
 *
 * Order, first match wins:
 *   profile:  --profile, TELENOW_PROFILE, the file's currentProfile, "default"
 *   key:      TELENOW_API_KEY, the profile's key
 *   base URL: --base-url, TELENOW_BASE_URL, then — only when the key came from the profile —
 *             the profile's base URL, then DEFAULT_BASE_URL.
 * A key from TELENOW_API_KEY never takes a profile's base URL: that profile may be another
 * server, and the key would be sent there.
 */

import { CliError, EXIT } from './cli_error.js';
import { checkProfileName, type ConfigFile } from './config_store.js';

export const DEFAULT_BASE_URL = 'https://api.telenow.ai';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** This computer: the only place plain http:// is allowed (base URLs, sign-in links). */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

export function checkBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new CliError(`'${raw}' is not a URL (expected e.g. ${DEFAULT_BASE_URL})`, EXIT.usage);
  }
  const loopback = isLoopbackHost(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    throw new CliError(
      `base URL must use https:// (plain http:// is allowed only for localhost): ${raw}`,
      EXIT.usage,
    );
  }
  if (u.username || u.password) throw new CliError('base URL must not contain a user name or password', EXIT.usage);
  if (u.search || u.hash) throw new CliError('base URL must not contain a query or a #fragment', EXIT.usage);
  return u.origin + u.pathname.replace(/\/+$/, '');
}

export interface LoginFlags {
  profile?: string;
  baseUrl?: string;
}

export function selectProfileName(flags: LoginFlags, env: Record<string, string | undefined>, cfg: ConfigFile): string {
  return checkProfileName(flags.profile ?? env.TELENOW_PROFILE ?? cfg.currentProfile ?? 'default');
}

export interface ResolvedLogin {
  profileName: string;
  apiKey: string;
  baseUrl: string;
  keySource: 'env' | 'profile';
  /** Known only when the key came from a profile that saved it at login. */
  orgId?: string;
  /** When the profile's key stops working (a browser login's key), on the profile's own server. */
  expiresAt?: string;
}

export function resolveLogin(flags: LoginFlags, env: Record<string, string | undefined>, cfg: ConfigFile): ResolvedLogin {
  const profileName = selectProfileName(flags, env, cfg);
  const explicitBase = flags.baseUrl ?? env.TELENOW_BASE_URL;
  const envKey = env.TELENOW_API_KEY?.trim();
  if (envKey) {
    return {
      profileName,
      apiKey: envKey,
      baseUrl: checkBaseUrl(explicitBase ?? DEFAULT_BASE_URL),
      keySource: 'env',
    };
  }
  const p = cfg.profiles[profileName];
  if (!p) {
    throw new CliError(
      `not signed in (no profile '${profileName}'): run \`telenow login\`, or set TELENOW_API_KEY`,
      EXIT.auth,
    );
  }
  const baseUrl = checkBaseUrl(explicitBase ?? p.baseUrl);
  return {
    profileName,
    apiKey: p.apiKey,
    baseUrl,
    keySource: 'profile',
    // The saved org and expiry belong to the saved server; another --base-url must ask again.
    orgId: baseUrl === checkBaseUrl(p.baseUrl) ? p.orgId : undefined,
    expiresAt: baseUrl === checkBaseUrl(p.baseUrl) ? p.expiresAt : undefined,
  };
}
