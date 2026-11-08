/**
 * start_campaign.ts — `telenow campaigns start <campaign-id>`: start dialling.
 *
 * In here: `startCampaignCommand`. Starting DIALS everyone not yet called and costs money, so it
 * reads the campaign, says how many people it will call, and asks (or needs `--yes`). Only a
 * draft or paused campaign starts; the status is read back afterwards (`change_status.ts`).
 * `--dry-run` shows the request.
 * Not in here: pausing (`pause_campaign.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun } from '../../core/write_request.js';
import { campaignId, describe, fetchCampaign } from './campaign_paths.js';
import { changeStatus } from './change_status.js';

export const startCampaignCommand: CommandSpec = {
  path: ['campaigns', 'start'],
  summary: 'start dialling a campaign — real calls that cost money (asks first, or --yes)',
  args: ['campaign-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = campaignId(ctx.args['campaign-id']);
    if (!isDryRun(ctx)) {
      const c = await fetchCampaign(ctx, id);
      await confirmAction(ctx, `Start ${describe(c)}: its agent will call them. Calls cost money.`);
    }
    return changeStatus(ctx, id, 'start', 'running', 'only a draft or paused campaign starts');
  },
};
