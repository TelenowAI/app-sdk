/**
 * list_calls.ts — `telenow calls list`: the org's calls, newest first, one page or `--all`.
 *
 * In here: `listCallsCommand` → `GET /api/orgs/:orgId/calls` (`agentId`, `status`, `from`,
 * `to`, `tz`, `number`, `sort`, `limit`, `offset`), and `CALL_SORTS` (the orders the route
 * takes; `export_calls.ts` shares it). The days in `--from` / `--to` are read in `--tz`, by
 * default this computer's zone (`core/local_timezone.ts`). The org id comes from the saved login, or from
 * `GET /api/v1/me` once. Short view by default, whole rows with `--full`; the server's
 * `warnings` (a filter it could not apply, say) and "more pages" go to stderr as notes.
 * Not in here: one call (`get_call.ts`), its transcript (`get_transcript.ts`).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, intOption, oneOf, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { timeZoneFor, TZ_OPTION } from '../../core/local_timezone.js';
import { fetchPages } from '../../core/paginate.js';

/** The orders the call routes take; anything else they quietly treat as newest. */
export const CALL_SORTS = ['newest', 'oldest', 'longest', 'shortest'] as const;

/** The short view: what happened, between whom, when and for how long. */
const SHORT_VIEW = [
  'id',
  'agent_name',
  'status',
  'direction',
  'channel',
  'from_number',
  'to_number',
  'start_time',
  'duration_sec',
  'disposition',
];

export const listCallsCommand: CommandSpec = {
  path: ['calls', 'list'],
  summary: "list the org's calls, newest first",
  options: {
    agent: { type: 'string', value: '<agent-id>', help: "only this agent's calls" },
    status: { type: 'string', value: '<status>', help: 'e.g. active, ended' },
    from: { type: 'string', value: '<YYYY-MM-DD>', help: 'started on or after this day' },
    to: { type: 'string', value: '<YYYY-MM-DD>', help: 'started on or before this day' },
    tz: TZ_OPTION,
    number: { type: 'string', value: '<digits>', help: 'either side of the call matches (comma-separated for several)' },
    sort: { type: 'string', value: '<order>', help: 'newest (default), oldest, longest or shortest' },
    limit: { type: 'string', value: '<n>', help: 'rows per page (the server caps it)' },
    offset: { type: 'string', value: '<n>', help: 'skip this many rows first' },
    all: { type: 'boolean', help: 'fetch every page' },
    full: { type: 'boolean', help: 'print whole call rows, not the short view' },
  },
  async run(ctx) {
    const v = ctx.values;
    const query = {
      agentId: stringOption(v, 'agent'),
      status: stringOption(v, 'status'),
      from: stringOption(v, 'from'),
      to: stringOption(v, 'to'),
      tz: timeZoneFor(ctx),
      number: stringOption(v, 'number'),
      sort: oneOf(v, 'sort', CALL_SORTS),
    };
    const path = `/api/orgs/${encodeURIComponent(await ctx.orgId())}/calls`;
    const warnings: unknown[] = [];
    const page = await fetchPages(
      async (off, lim) => {
        const d = dataOf((await ctx.api().get(path, { query: { ...query, offset: off, limit: lim } })).body) as {
          calls?: unknown;
          total?: unknown;
          warnings?: unknown;
        } | null;
        if (Array.isArray(d?.warnings) && warnings.length === 0) warnings.push(...d.warnings);
        return {
          items: Array.isArray(d?.calls) ? (d.calls as unknown[]) : [],
          total: typeof d?.total === 'number' ? d.total : null,
        };
      },
      { offset: intOption(v, 'offset', 0) ?? 0, limit: intOption(v, 'limit', 1), all: boolOption(v, 'all') },
    );
    const notes: unknown[] = warnings.map((w) => ({ warning: w }));
    if (page.nextOffset !== null) notes.push({ more: { total: page.total, nextOffset: page.nextOffset } });
    return { data: page.items, defaultFields: boolOption(v, 'full') ? undefined : SHORT_VIEW, notes };
  },
};
