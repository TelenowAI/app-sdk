/**
 * pause_campaign.ts — `telenow campaigns pause <campaign-id>`: stop dialling for now.
 *
 * In here: `pauseCampaignCommand`. Pausing only stops new calls (calls in progress finish), and
 * `campaigns start` resumes it, so it does not ask. Only a running campaign pauses; the status is
 * read back afterwards (`change_status.ts`). `--dry-run` shows the request.
 * Not in here: stopping for good (`cancel_campaign.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION } from '../../core/write_request.js';
import { campaignId } from './campaign_paths.js';
import { changeStatus } from './change_status.js';

export const pauseCampaignCommand: CommandSpec = {
  path: ['campaigns', 'pause'],
  summary: 'stop dialling a campaign for now (start resumes it)',
  args: ['campaign-id'],
  options: { 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    return changeStatus(ctx, campaignId(ctx.args['campaign-id']), 'pause', 'paused', 'only a running campaign pauses');
  },
};
