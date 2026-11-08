/**
 * get_campaign.ts — `telenow campaigns get <campaign-id>`: one campaign.
 *
 * In here: `getCampaignCommand` → `GET /api/orgs/:orgId/campaigns/:id`: the campaign row plus
 * `agent_uses_dtmf` and `dial_block` (why it is not dialling right now — the account or the
 * calling window — or null).
 * Not in here: its calls (`list_campaign_calls.ts`), outcomes (`campaign_results.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { fetchCampaign } from './campaign_paths.js';

export const getCampaignCommand: CommandSpec = {
  path: ['campaigns', 'get'],
  summary: 'show one campaign, and why it is not dialling if it is not',
  args: ['campaign-id'],
  async run(ctx) {
    return { data: await fetchCampaign(ctx, ctx.args['campaign-id']) };
  },
};
