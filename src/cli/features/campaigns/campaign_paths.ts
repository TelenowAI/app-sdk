/**
 * campaign_paths.ts — what every campaign command shares.
 *
 * In here: `campaignPath` (`/api/orgs/<org>/campaigns` + suffix — the org routes: full life
 * cycle, `{ success, data }`), `v1CampaignPath` (`/api/v1/campaigns/<id>` + suffix — used for
 * JSON target pushes, which dedupe by each row's `id`, and for per-person results), `fetchCampaign`
 * (one campaign row, snake_case, `status` draft | running | paused | completed | cancelled) and
 * `SHORT_VIEW`.
 * Why both route families: start / pause / cancel on the org routes answer success even when
 * nothing changed, so commands read the campaign back; v1 has no cancel, CSV upload or calls list.
 * Not in here: the commands.
 * Called by: every file in `features/campaigns/`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandContext } from '../../core/command_spec.js';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface CampaignRow {
  id?: string;
  name?: string;
  status?: string;
  agent_id?: string;
  total_targets?: number;
  completed_targets?: number;
  failed_targets?: number;
  [key: string]: unknown;
}

export const SHORT_VIEW = ['id', 'name', 'status', 'agent_id', 'total_targets', 'completed_targets', 'failed_targets', 'created_at'];

export function campaignId(raw: string): string {
  if (!SAFE.test(raw)) throw new CliError(`'${raw}' is not a campaign id`, EXIT.usage);
  return raw;
}

export async function campaignPath(ctx: CommandContext, suffix: string): Promise<string> {
  return ctx.orgPath(`/campaigns${suffix}`);
}

export function v1CampaignPath(id: string, suffix: string): string {
  return `/api/v1/campaigns/${campaignId(id)}${suffix}`;
}

export async function fetchCampaign(ctx: CommandContext, id: string): Promise<CampaignRow> {
  const d = dataOf((await ctx.api().get(await campaignPath(ctx, `/${campaignId(id)}`))).body) as CampaignRow | null;
  if (!d || typeof d !== 'object') throw new CliError(`the server sent no campaign for ${id}`, EXIT.server);
  return d;
}

export function describe(c: CampaignRow): string {
  const pending = (c.total_targets ?? 0) - (c.completed_targets ?? 0) - (c.failed_targets ?? 0);
  return `campaign "${c.name ?? c.id}" (${c.status ?? 'unknown status'}, ${c.total_targets ?? 0} people, ${Math.max(0, pending)} not yet called)`;
}
