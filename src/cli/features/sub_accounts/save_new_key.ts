/**
 * save_new_key.ts — where a newly made sub-account key goes, so its secret never has to be shown
 * (TELENOW_CLI_PLAN.md §15.3, decision D5).
 *
 * In here:
 * - `KEY_DESTINATION_OPTIONS`: `--save-profile <name>`, `--key-file <path>` and `--show-key`.
 * - `keyDestination`: reads them BEFORE anything is sent. One of them is required, and a profile
 *   name already used or a file already there is refused. The server shows a key's secret only once,
 *   so a key that cannot be stored must never be made.
 * - `storeNewKey`: puts the secret where it was asked to go.
 *   - A profile: in the saved-logins file (mode 600, `config_store.ts`), on the same server, with the
 *     sub-account as its org. It is used with `--profile <name>` and never becomes the current login
 *     by itself.
 *   - A file: created new, mode 600, holding the key and a newline.
 *   - `--show-key`: printed with the answer, for a secret store fed from a pipe. Only then does it
 *     reach the screen or a log.
 * - `withoutSecret`: the server's answer with `apiKey.key` taken out. Every output and `--output raw`
 *   are built from it, so the secret never reaches stdout unless `--show-key`.
 * Not in here: the routes (`create_sub_account.ts`, `rotate_sub_account_key.ts`).
 * Called by: `create_sub_account.ts`, `rotate_sub_account_key.ts`.
 */

import { chmodSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandContext, type OptionSpec } from '../../core/command_spec.js';
import { checkProfileName, readConfig, writeConfig } from '../../core/config_store.js';

export const KEY_DESTINATION_OPTIONS: Record<string, OptionSpec> = {
  'save-profile': { type: 'string', value: '<name>', help: 'save the new key as a login profile (use it with --profile <name>)' },
  'key-file': { type: 'string', value: '<path>', help: 'write the new key to this new file (owner-only)' },
  'show-key': { type: 'boolean', help: 'print the new key (shown only once; it lands in your terminal and its logs)' },
};

export interface KeyDestination {
  profile?: string;
  file?: string;
  show: boolean;
}

export interface NewKey {
  id?: string;
  key: string;
  lastFour?: string;
  name?: string;
  role?: string;
  createdAt?: string;
}

export function keyDestination(ctx: CommandContext): KeyDestination {
  const profile = stringOption(ctx.values, 'save-profile');
  const rawFile = stringOption(ctx.values, 'key-file');
  const show = boolOption(ctx.values, 'show-key');
  if (profile === undefined && rawFile === undefined && !show) {
    throw new CliError(
      'say where the new key goes: --save-profile <name>, --key-file <path>, or --show-key (its secret is shown only once)',
      EXIT.usage,
      { code: 'key_destination' },
    );
  }
  if (profile !== undefined) {
    checkProfileName(profile);
    if (readConfig(ctx.configFile).profiles[profile]) {
      throw new CliError(`a login profile named '${profile}' already exists; choose another name`, EXIT.usage, { code: 'profile_exists' });
    }
  }
  let file: string | undefined;
  if (rawFile !== undefined) {
    file = resolve(ctx.cwd, rawFile);
    if (existsSync(file)) throw new CliError(`${file} already exists; the key goes only to a new file`, EXIT.usage, { code: 'file_exists' });
    const parent = dirname(file);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new CliError(`the folder for --key-file does not exist: ${parent}`, EXIT.usage);
  }
  return { profile, file, show };
}

/** Stores the key; returns where it went, for the output. */
export function storeNewKey(
  ctx: CommandContext,
  dest: KeyDestination,
  key: NewKey,
  sub: { id: string; name?: string },
): Record<string, unknown> {
  const savedTo: Record<string, unknown> = {};
  if (dest.profile !== undefined) {
    const cfg = readConfig(ctx.configFile);
    if (cfg.profiles[dest.profile]) {
      throw new CliError(`a login profile named '${dest.profile}' appeared meanwhile; the key was not saved (rotate it again)`, EXIT.usage);
    }
    cfg.profiles[dest.profile] = {
      apiKey: key.key,
      baseUrl: ctx.login().baseUrl,
      orgId: sub.id,
      orgName: sub.name,
      keyName: key.name,
      keyRole: key.role,
      keyId: key.id,
      savedAt: new Date().toISOString(),
    };
    writeConfig(ctx.configFile, cfg);
    savedTo.profile = dest.profile;
  }
  if (dest.file !== undefined) {
    writeFileSync(dest.file, key.key + '\n', { flag: 'wx', mode: 0o600 });
    chmodSync(dest.file, 0o600);
    savedTo.file = dest.file;
  }
  return savedTo;
}

/** A copy of an answer with `apiKey.key` removed (the secret), everything else kept. */
export function withoutSecret(body: unknown): Record<string, unknown> {
  const b = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {};
  if (b.apiKey && typeof b.apiKey === 'object') {
    const { key: _secret, ...rest } = b.apiKey as Record<string, unknown>;
    b.apiKey = rest;
  }
  return b;
}
