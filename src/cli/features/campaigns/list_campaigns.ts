/**
 * list_campaigns.ts — `telenow campaigns list`: the org's campaigns.
 *
 * In here: `listCampaignsCommand` → `GET /api/orgs/:orgId/campaigns` (`data.campaigns`, `total`).
 * Short view by default (`--full` for whole rows).
 * Not in here: one campaign (`get_campaign.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, type CommandSpec } from '../../core/command_spec.js';
import { campaignPath, SHORT_VIEW } from './campaign_paths.js';

export const listCampaignsCommand: CommandSpec = {
  path: ['campaigns', 'list'],
  summary: "list the org's campaigns",
  options: { full: { type: 'boolean', help: 'print whole rows, not the short view' } },
  async run(ctx) {
    const res = await ctx.api().get(await campaignPath(ctx, ''));
    const d = dataOf(res.body) as { campaigns?: unknown } | null;
    return {
      data: Array.isArray(d?.campaigns) ? d.campaigns : [],
      defaultFields: boolOption(ctx.values, 'full') ? undefined : SHORT_VIEW,
      raw: res.body,
    };
  },
};
