/**
 * list_campaign_calls.ts — `telenow campaigns calls <campaign-id>`: the people in a campaign and
 * where each one is.
 *
 * In here: `listCampaignCallsCommand` → `GET /api/orgs/:orgId/campaigns/:id/calls` (`status`
 * pending | dialing | completed | failed | skipped, `limit`, `offset`): `data.calls` (one row per
 * person: `phone_number`, `status`, `attempt`, `session_id` — the call to open with `calls get` —,
 * `last_error`, …) and `total`; `statusCounts` goes to stderr as a note. `--all` pages.
 * Not in here: answered / no-answer outcomes per person (`campaign_results.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, intOption, oneOf, type CommandSpec } from '../../core/command_spec.js';
import { fetchPages } from '../../core/paginate.js';
import { campaignId, campaignPath } from './campaign_paths.js';

export const listCampaignCallsCommand: CommandSpec = {
  path: ['campaigns', 'calls'],
  summary: 'list the people in a campaign and where each one is',
  args: ['campaign-id'],
  options: {
    status: { type: 'string', value: '<status>', help: 'pending, dialing, completed, failed or skipped' },
    limit: { type: 'string', value: '<n>', help: 'rows per page (the server caps it)' },
    offset: { type: 'string', value: '<n>', help: 'skip this many rows first' },
    all: { type: 'boolean', help: 'fetch every page' },
    full: { type: 'boolean', help: 'print whole rows, not the short view' },
  },
  async run(ctx) {
    const v = ctx.values;
    const path = await campaignPath(ctx, `/${campaignId(ctx.args['campaign-id'])}/calls`);
    const status = oneOf(v, 'status', ['pending', 'dialing', 'completed', 'failed', 'skipped'] as const);
    let counts: unknown;
    const page = await fetchPages(
      async (off, lim) => {
        const d = dataOf((await ctx.api().get(path, { query: { status, offset: off, limit: lim } })).body) as {
          calls?: unknown;
          total?: unknown;
          statusCounts?: unknown;
        } | null;
        counts ??= d?.statusCounts;
        return { items: Array.isArray(d?.calls) ? (d.calls as unknown[]) : [], total: typeof d?.total === 'number' ? d.total : null };
      },
      { offset: intOption(v, 'offset', 0) ?? 0, limit: intOption(v, 'limit', 1), all: boolOption(v, 'all') },
    );
    const notes: unknown[] = counts ? [{ statusCounts: counts }] : [];
    if (page.nextOffset !== null) notes.push({ more: { total: page.total, nextOffset: page.nextOffset } });
    return {
      data: page.items,
      defaultFields: boolOption(v, 'full') ? undefined : ['id', 'phone_number', 'status', 'attempt', 'duration_sec', 'session_id', 'last_error'],
      notes,
    };
  },
};
