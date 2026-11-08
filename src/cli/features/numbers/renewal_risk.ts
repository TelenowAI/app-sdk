/**
 * renewal_risk.ts — `telenow numbers renewal-risk`: which numbers renew soon, and whether the
 * balance covers them.
 *
 * In here: `renewalRiskCommand` → `GET /api/voice/numbers/renewal-risk` → `{ mode (prepaid |
 * postpaid | billed_to_parent), balanceUsd, graceDays, prealertDays, numbers: [{ id, e164,
 * nextRenewalAt, rentUsd, status, shortfallUsd, daysUntilRenewal }] }`. `status` is one of ok,
 * renews_soon, renewing, at_risk, overdue or not_applicable. The shortfall adds up in renewal
 * order. Printed as it comes; USD amounts are decimal strings.
 * Not in here: buying a lost number back (`reclaim_number.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const renewalRiskCommand: CommandSpec = {
  path: ['numbers', 'renewal-risk'],
  summary: 'show which numbers renew soon and whether your balance covers them',
  async run(ctx) {
    const res = await ctx.api().get('/api/voice/numbers/renewal-risk');
    return { data: dataOf(res.body), raw: res.body };
  },
};
