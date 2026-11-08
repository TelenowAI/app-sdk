/**
 * command_spec.ts — the shape every account command is declared in.
 *
 * In here: `CommandSpec` (path, summary, positional args, options, `run`), `OptionSpec`,
 * `CommandContext` (what `run` receives), `CliIo`, and the small option readers
 * (`stringOption`, `intOption`, `boolOption`, `oneOf`).
 * Not in here: building the context (`command_context.ts`), dispatch and help (`main.ts`,
 * `help_text.ts`).
 * Called by: every command file, `main.ts`, `command_context.ts`, `help_text.ts`.
 */

import type { ApiClient } from './api_client.js';
import { CliError, EXIT } from './cli_error.js';
import type { OpenUrl } from './open_browser.js';
import type { CommandOutput } from './print_output.js';
import type { ResolvedLogin } from './resolve_login.js';

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  /** May be given more than once (`--var a=1 --var b=2`); read with `listOption`. */
  multiple?: boolean;
  /** Shown in help, e.g. `<n>` for `--limit <n>`. */
  value?: string;
  help: string;
}

export interface CommandSpec {
  /** Words typed after `telenow`, e.g. ['agents', 'list']. */
  path: string[];
  summary: string;
  /** Required positional arguments, in order (shown as `<name>`). */
  args?: string[];
  options?: Record<string, OptionSpec>;
  run(ctx: CommandContext): Promise<CommandOutput>;
}

export interface WritableLike {
  write(s: string): unknown;
}

export interface CliIo {
  stdout: WritableLike;
  stderr: WritableLike;
  stdin: NodeJS.ReadableStream;
  stdinIsTTY: boolean;
}

export type OptionValues = Record<string, string | boolean | string[] | undefined>;

export interface CommandContext {
  /** Positional arguments by the names in `CommandSpec.args`. */
  args: Record<string, string>;
  /** Command options (global options are in `global`). */
  values: OptionValues;
  global: { profile?: string; baseUrl?: string; quiet: boolean };
  env: Record<string, string | undefined>;
  io: CliIo;
  cwd: string;
  /** Path of the saved-logins file. */
  configFile: string;
  /** The login this command runs as; throws "not signed in" when there is none. */
  login(): ResolvedLogin;
  /** A client for `login()`. */
  api(): ApiClient;
  /** A client for a key that is not saved yet (`telenow login`); an empty key sends none. */
  apiFor(baseUrl: string, apiKey: string): ApiClient;
  /** Wait `ms`; returns early when `signal` fires. Tests record the waits instead. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Open a link in the person's browser (`core/open_browser.ts`); tests inject their own. */
  openUrl: OpenUrl;
  /** The org the key belongs to: from the profile, else asked from `GET /api/v1/me` once. */
  orgId(): Promise<string>;
  /** `/api/orgs/<the key's org>` + `suffix` (suffix starts with `/` or is empty). */
  orgPath(suffix: string): Promise<string>;
  /** Every account command, and the app-command usage lines `bin/telenow.mjs` passed in. */
  catalog: { commands: CommandSpec[]; appUsage?: string };
}

export function stringOption(v: OptionValues, name: string): string | undefined {
  const x = v[name];
  return typeof x === 'string' ? x : undefined;
}

export function listOption(v: OptionValues, name: string): string[] {
  const x = v[name];
  if (Array.isArray(x)) return x;
  return typeof x === 'string' ? [x] : [];
}

export function boolOption(v: OptionValues, name: string): boolean {
  return v[name] === true;
}

export function intOption(v: OptionValues, name: string, min: number): number | undefined {
  const x = stringOption(v, name);
  if (x === undefined) return undefined;
  const n = Number(x);
  if (!Number.isInteger(n) || n < min) {
    throw new CliError(`--${name} must be a whole number of at least ${min} (got '${x}')`, EXIT.usage);
  }
  return n;
}

export function oneOf<T extends string>(v: OptionValues, name: string, allowed: readonly T[]): T | undefined {
  const x = stringOption(v, name);
  if (x === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(x)) {
    throw new CliError(`--${name} must be one of ${allowed.join(', ')} (got '${x}')`, EXIT.usage);
  }
  return x as T;
}
