/**
 * campaign_results.ts — `telenow campaigns results <campaign-id>`: who was reached, per person.
 *
 * In here: `campaignResultsCommand` → `GET /api/v1/campaigns/:id/results` (`outcome`, `since`,
 * `cursor`, `limit`): one row per person whose calls are over — `callId`, `phone`, `id` (yours),
 * `source`, `outcome` (answered | no-answer | busy | machine | failed | …), `attempt`,
 * `completedAt`. Pages by cursor; `--all` follows it to the end, else a note gives the next
 * cursor. The route answers an EMPTY list for an unknown campaign, so the campaign is read first
 * (a 404 there is exit 3).
 * Not in here: people not finished yet (`list_campaign_calls.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import { boolOption, intOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { campaignId, fetchCampaign, v1CampaignPath } from './campaign_paths.js';

export const campaignResultsCommand: CommandSpec = {
  path: ['campaigns', 'results'],
  summary: 'show the outcome for each person whose calls are over',
  args: ['campaign-id'],
  options: {
    outcome: { type: 'string', value: '<outcome>', help: 'e.g. answered, no-answer, busy, machine, failed' },
    since: { type: 'string', value: '<RFC 3339 time>', help: 'only results completed after this time' },
    cursor: { type: 'string', value: '<cursor>', help: 'continue from a previous page' },
    limit: { type: 'string', value: '<n>', help: 'rows per page (the server caps it)' },
    all: { type: 'boolean', help: 'follow the cursor to the end' },
  },
  async run(ctx) {
    const v = ctx.values;
    const id = campaignId(ctx.args['campaign-id']);
    await fetchCampaign(ctx, id);
    const all = boolOption(v, 'all');
    const rows: unknown[] = [];
    let cursor = stringOption(v, 'cursor');
    let next: string | null = null;
    for (;;) {
      const body = (await ctx.api().get(v1CampaignPath(id, '/results'), {
        query: { outcome: stringOption(v, 'outcome'), since: cursor ? undefined : stringOption(v, 'since'), cursor, limit: intOption(v, 'limit', 1) },
      })).body as { results?: unknown; nextCursor?: unknown } | null;
      const page = Array.isArray(body?.results) ? body.results : [];
      rows.push(...page);
      next = typeof body?.nextCursor === 'string' ? body.nextCursor : null;
      if (!all || next === null || page.length === 0) break;
      cursor = next;
    }
    return { data: rows, notes: !all && next !== null ? [{ more: { nextCursor: next } }] : [] };
  },
};
