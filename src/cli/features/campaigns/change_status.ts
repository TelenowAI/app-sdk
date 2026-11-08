/**
 * change_status.ts — the one way `start`, `pause` and `cancel` change a campaign.
 *
 * In here: `changeStatus`. It sends `POST /api/orgs/:orgId/campaigns/:id/<action>`, then READS THE
 * CAMPAIGN BACK, because those routes answer "campaign started" even when nothing changed (a
 * completed campaign, a missing one). If the status read back is not the one asked for, the
 * command fails (exit 1) and says what the campaign is instead.
 * Not in here: the confirm rule (each command asks before calling this) — `--dry-run` returns
 * the request from here without sending.
 * Called by: `start_campaign.ts`, `pause_campaign.ts`, `cancel_campaign.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandContext } from '../../core/command_spec.js';
import type { CommandOutput } from '../../core/print_output.js';
import { sendWrite } from '../../core/write_request.js';
import { campaignPath, fetchCampaign } from './campaign_paths.js';

export async function changeStatus(
  ctx: CommandContext,
  id: string,
  action: 'start' | 'pause' | 'cancel',
  want: string,
  why: string,
): Promise<CommandOutput> {
  const w = await sendWrite(ctx, { method: 'POST', path: await campaignPath(ctx, `/${id}/${action}`) });
  if (!w.sent) return { data: w.dryRun };
  const after = await fetchCampaign(ctx, id);
  if (after.status !== want) {
    throw new CliError(`the campaign is ${after.status ?? 'in an unknown state'}, not ${want}: ${why}`, EXIT.usage, {
      code: 'campaign_status_unchanged',
      details: { campaignId: id, status: after.status ?? null },
    });
  }
  return { data: { campaignId: id, status: after.status, name: after.name ?? null } };
}
