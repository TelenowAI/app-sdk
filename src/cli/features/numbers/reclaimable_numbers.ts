/**
 * reclaimable_numbers.ts — `telenow numbers reclaimable`: lost numbers that can still be bought back.
 *
 * In here: `reclaimableCommand` → `GET /api/voice/numbers/reclaimable` → `{ numbers: [{ id, e164,
 * provider, releasedAt, reclaimDeadlineAt, releaseReason, binding, reclaimRequestedAt,
 * lastMonthlyRent, lastSetupPrice, priceCurrency, lastMonthlyRentUsd, lastSetupPriceUsd }], total }`.
 * These are numbers the platform released (for non-payment, say) whose carrier still holds them
 * until `reclaimDeadlineAt`. A number the org released itself is never here.
 * Not in here: buying one back (`reclaim_number.ts`, which reads this list for the price).
 * Called by: `features/numbers/register.ts`, `reclaim_number.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandContext, CommandSpec } from '../../core/command_spec.js';

export interface ReclaimableRow {
  id: string;
  e164?: string;
  provider?: string;
  reclaimDeadlineAt?: string;
  releaseReason?: string | null;
  lastMonthlyRent?: string | null;
  lastSetupPrice?: string | null;
  priceCurrency?: string | null;
  lastMonthlyRentUsd?: string | null;
  lastSetupPriceUsd?: string | null;
  [k: string]: unknown;
}

export async function listReclaimable(ctx: CommandContext): Promise<{ rows: ReclaimableRow[]; raw: unknown }> {
  const res = await ctx.api().get('/api/voice/numbers/reclaimable');
  const d = (dataOf(res.body) ?? {}) as { numbers?: unknown };
  return { rows: Array.isArray(d.numbers) ? (d.numbers as ReclaimableRow[]) : [], raw: res.body };
}

export const reclaimableCommand: CommandSpec = {
  path: ['numbers', 'reclaimable'],
  summary: 'list lost numbers that can still be bought back, and until when',
  async run(ctx) {
    const { rows, raw } = await listReclaimable(ctx);
    return { data: rows, raw };
  },
};
