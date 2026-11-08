/**
 * config_store.ts — the file that holds saved logins (profiles).
 *
 * In here: where the file lives (`configPath`), reading it (`readConfig`), writing it with
 * owner-only permissions (`writeConfig`), and the profile-name rule (`checkProfileName`).
 * Not in here: which profile a command uses, or env-variable overrides (`resolve_login.ts`).
 * The CLI reads NO config from the current folder: a cloned repo must not be able to point the
 * saved key at another server.
 * Called by: `resolve_login.ts`, the auth commands.
 *
 * File: `$TELENOW_CONFIG`, else `$XDG_CONFIG_HOME/telenow/config.json`, else
 * `~/.config/telenow/config.json`. Shape:
 *   { "currentProfile": "default",
 *     "profiles": { "default": { "apiKey": "…", "baseUrl": "https://api.telenow.ai",
 *                                "orgId": "…", "orgName": "…", "keyName": "…", "keyRole": "…",
 *                                "savedAt": "…",
 *                                "keyId": "…", "expiresAt": "…" } } }
 * `keyId` and `expiresAt` are saved by the browser login only (the server says them when it
 * hands the new key over); a pasted key has neither.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CliError, EXIT } from './cli_error.js';

export interface Profile {
  apiKey: string;
  baseUrl: string;
  orgId?: string;
  orgName?: string;
  keyName?: string;
  keyRole?: string;
  savedAt?: string;
  /** The key's id on the server (browser login). */
  keyId?: string;
  /** ISO time the key stops working (browser login; absent when it never expires). */
  expiresAt?: string;
}

export interface ConfigFile {
  currentProfile?: string;
  profiles: Record<string, Profile>;
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function checkProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw new CliError(
      `profile name '${name}' must start with a letter or digit and use only letters, digits, '.', '_' or '-'`,
      EXIT.usage,
    );
  }
  return name;
}

export function configPath(env: Record<string, string | undefined>, homedir: string): string {
  if (env.TELENOW_CONFIG) return env.TELENOW_CONFIG;
  const base = env.XDG_CONFIG_HOME || join(homedir, '.config');
  return join(base, 'telenow', 'config.json');
}

export function readConfig(path: string): ConfigFile {
  if (!existsSync(path)) return { profiles: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new CliError(`the config file is not valid JSON: ${path}`, EXIT.usage);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(`the config file is not a JSON object: ${path}`, EXIT.usage);
  }
  const o = parsed as Record<string, unknown>;
  const profiles: Record<string, Profile> = {};
  const raw = o.profiles && typeof o.profiles === 'object' ? (o.profiles as Record<string, unknown>) : {};
  for (const [name, p] of Object.entries(raw)) {
    if (p && typeof p === 'object') {
      const q = p as Record<string, unknown>;
      if (typeof q.apiKey === 'string' && typeof q.baseUrl === 'string') {
        profiles[name] = q as unknown as Profile;
      }
    }
  }
  return {
    currentProfile: typeof o.currentProfile === 'string' ? o.currentProfile : undefined,
    profiles,
  };
}

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
export function writeConfig(path: string, cfg: ConfigFile): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  // `mode` above is masked by the umask; set it outright so the key is never group-readable.
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
