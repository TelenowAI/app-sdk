/**
 * cancel_campaign.ts — `telenow campaigns cancel <campaign-id>`: stop a campaign for good.
 *
 * In here: `cancelCampaignCommand`. Cancelling skips everyone not yet called and cannot be
 * undone (a cancelled campaign takes no new people either), so it asks (or needs `--yes`). The
 * status is read back afterwards (`change_status.ts`). `--dry-run` shows the request.
 * Not in here: pausing, which can be resumed (`pause_campaign.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun } from '../../core/write_request.js';
import { campaignId, describe, fetchCampaign } from './campaign_paths.js';
import { changeStatus } from './change_status.js';

export const cancelCampaignCommand: CommandSpec = {
  path: ['campaigns', 'cancel'],
  summary: 'stop a campaign for good; people not yet called are skipped (asks first, or --yes)',
  args: ['campaign-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = campaignId(ctx.args['campaign-id']);
    if (!isDryRun(ctx)) {
      const c = await fetchCampaign(ctx, id);
      await confirmAction(ctx, `Cancel ${describe(c)}: nobody else is called, and it cannot be restarted.`);
    }
    return changeStatus(ctx, id, 'cancel', 'cancelled', 'a completed campaign cannot be cancelled');
  },
};
