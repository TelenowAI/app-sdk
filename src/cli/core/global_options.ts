/**
 * global_options.ts — the options every account command takes.
 *
 * In here: `GLOBAL_OPTIONS` (`--profile`, `--base-url`, `--fields`, `--output`, `--quiet`,
 * `--help`). Options that only some commands take (`--dry-run`, `--limit`, …) are declared by
 * those commands.
 * Not in here: reading them (`main.ts`), what they mean (`resolve_login.ts`,
 * `print_output.ts`, `pick_fields.ts`).
 * Called by: `main.ts`, `help_text.ts`.
 */

import type { OptionSpec } from './command_spec.js';

export const GLOBAL_OPTIONS: Record<string, OptionSpec> = {
  profile: { type: 'string', value: '<name>', help: 'saved login to use (default: the current one)' },
  'base-url': { type: 'string', value: '<url>', help: 'server, e.g. https://api.telenow.ai' },
  fields: { type: 'string', value: '<a,b.c>', help: 'print only these fields' },
  output: { type: 'string', value: '<mode>', help: 'json (default), table or raw' },
  quiet: { type: 'boolean', help: 'print no notes on stderr' },
  help: { type: 'boolean', short: 'h', help: 'show help' },
};
