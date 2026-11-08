/**
 * sub_account_usage.ts — `telenow sub-accounts usage <id> [--from] [--to]`: what a sub-account used.
 *
 * In here: `subAccountUsageCommand` → `GET /api/v1/sub-accounts/:id/usage?from&to` → `{ subAccountId, from,
 * to, calls, billableSeconds, spendUsd, activeCalls, monthToDateSpendUsd, totalSpendUsd, limits, status }`.
 * `--from` / `--to` are RFC 3339 instants (`2026-11-01T00:00:00Z`); the window defaults to this billing
 * month so far. The client URL-encodes them, so a `+05:30` offset arrives intact. The server refuses a
 * bad instant or `from` not before `to` (400).
 * Not in here: the sub-account itself (`get_sub_account.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { subPath } from './sub_account_paths.js';

export const subAccountUsageCommand: CommandSpec = {
  path: ['sub-accounts', 'usage'],
  summary: "show a sub-account's calls and spend over a window (default: this month)",
  args: ['id'],
  options: {
    from: { type: 'string', value: '<instant>', help: 'start, e.g. 2026-11-01T00:00:00Z' },
    to: { type: 'string', value: '<instant>', help: 'end (default: now)' },
  },
  async run(ctx) {
    const res = await ctx.api().get(subPath(ctx.args.id, '/usage'), {
      query: { from: stringOption(ctx.values, 'from'), to: stringOption(ctx.values, 'to') },
    });
    return { data: res.body, raw: res.body };
  },
};
