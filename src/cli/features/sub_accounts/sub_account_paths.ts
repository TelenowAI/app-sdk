/**
 * sub_account_paths.ts — what the sub-account commands share: the route, the id check, the limits.
 *
 * In here:
 * - `subPath(id?, suffix?)`: `/api/v1/sub-accounts[/<id>][suffix]`, the public mount (org API key only,
 *   flat JSON with no `{ success, data }`, strict bodies: an unknown field is a 400).
 * - `subId`: an id that goes into a path.
 * - `LIMIT_OPTIONS` and `limitsFrom`: `--monthly-limit`, `--total-limit` (USD) and `--max-concurrent`.
 *   USD goes as the decimal text typed, so the server keeps it exact. `none` sends `null` (no limit),
 *   `0` stops it. An option not given is not sent, so it stays as it is.
 * Every sub-account route needs a key whose role is owner or admin, made by someone who is an owner or
 * admin, reads included (the server answers 403 otherwise). Its spending comes out of the parent's
 * wallet.
 * Not in here: the commands; where a new key goes (`save_new_key.ts`).
 * Called by: every file in `features/sub_accounts/`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandContext, type OptionSpec } from '../../core/command_spec.js';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function subId(raw: string): string {
  if (!SAFE.test(raw)) throw new CliError(`'${raw}' is not a sub-account id (see telenow sub-accounts list)`, EXIT.usage);
  return raw;
}

export function subPath(id?: string, suffix = ''): string {
  return `/api/v1/sub-accounts${id === undefined ? '' : `/${subId(id)}`}${suffix}`;
}

export const LIMIT_OPTIONS: Record<string, OptionSpec> = {
  'monthly-limit': { type: 'string', value: '<usd|none>', help: "most it may spend in a calendar month, in USD ('none': no limit, 0: stopped)" },
  'total-limit': { type: 'string', value: '<usd|none>', help: "most it may ever spend, in USD ('none': no limit, 0: stopped)" },
  'max-concurrent': { type: 'string', value: '<n|none>', help: "most calls at once ('none': no limit)" },
};

const USD = /^\d+(\.\d+)?$/;

/** The `limits` object to send: only the options given; `undefined` when none was. */
export function limitsFrom(ctx: CommandContext): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [opt, field] of [
    ['monthly-limit', 'monthlySpendLimitUsd'],
    ['total-limit', 'totalSpendLimitUsd'],
  ] as const) {
    const v = stringOption(ctx.values, opt)?.trim();
    if (v === undefined) continue;
    if (v === 'none') out[field] = null;
    else if (USD.test(v)) out[field] = v;
    else throw new CliError(`--${opt} must be an amount in USD such as 50 or 12.5, or 'none' (got '${v}')`, EXIT.usage);
  }
  const c = stringOption(ctx.values, 'max-concurrent')?.trim();
  if (c !== undefined) {
    if (c === 'none') out.maxConcurrentCalls = null;
    else if (/^\d+$/.test(c)) out.maxConcurrentCalls = Number(c);
    else throw new CliError(`--max-concurrent must be a whole number or 'none' (got '${c}')`, EXIT.usage);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
