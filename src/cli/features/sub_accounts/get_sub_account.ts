/**
 * get_sub_account.ts — `telenow sub-accounts get <id>`: one sub-account, its limits and this month's use.
 *
 * In here: `getSubAccountCommand` → `GET /api/v1/sub-accounts/:id` → `{ id, name, externalId, status,
 * limits, suspendedAt, suspendedReason, closedAt, createdAt, updatedAt, usage: { monthToDateSpendUsd,
 * activeCalls } }`. Another org's id is 404 like an unknown one. `readSubAccount` is shared with the
 * commands that ask first.
 * Not in here: spending over a window (`sub_account_usage.ts`).
 * Called by: `features/sub_accounts/register.ts`, `suspend_sub_account.ts`, `close_sub_account.ts`,
 * `rotate_sub_account_key.ts`.
 */

import type { CommandContext, CommandSpec } from '../../core/command_spec.js';
import { subPath } from './sub_account_paths.js';

export interface SubAccount {
  id: string;
  name?: string;
  status?: string;
  usage?: { activeCalls?: number; monthToDateSpendUsd?: number };
  [k: string]: unknown;
}

export async function readSubAccount(ctx: CommandContext, id: string): Promise<SubAccount> {
  const b = (await ctx.api().get(subPath(id))).body;
  return (b && typeof b === 'object' ? b : { id }) as SubAccount;
}

export const getSubAccountCommand: CommandSpec = {
  path: ['sub-accounts', 'get'],
  summary: 'show one sub-account, its limits and this month\'s use',
  args: ['id'],
  async run(ctx) {
    const s = await readSubAccount(ctx, ctx.args.id);
    return { data: s, raw: s };
  },
};
