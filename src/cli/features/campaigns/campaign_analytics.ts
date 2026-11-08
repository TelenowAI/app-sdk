/**
 * campaign_analytics.ts — `telenow campaigns analytics <campaign-id>`: the campaign's numbers.
 *
 * In here: `campaignAnalyticsCommand` → `GET /api/orgs/:orgId/campaigns/:id/analytics`: totals
 * such as `targets`, `dialled`, `reached`, `unreached`, failure reasons, and the hours calls were
 * dialled and reached (camelCase, as the server sends them).
 * Not in here: per-person rows (`list_campaign_calls.ts`, `campaign_results.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { campaignId, campaignPath } from './campaign_paths.js';

export const campaignAnalyticsCommand: CommandSpec = {
  path: ['campaigns', 'analytics'],
  summary: "show a campaign's totals: dialled, reached, failure reasons, best hours",
  args: ['campaign-id'],
  async run(ctx) {
    const res = await ctx.api().get(await campaignPath(ctx, `/${campaignId(ctx.args['campaign-id'])}/analytics`));
    return { data: dataOf(res.body), raw: res.body };
  },
};
