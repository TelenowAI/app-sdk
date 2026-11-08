/**
 * list_dnc.ts — `telenow dnc list`: the org's do-not-call list.
 *
 * In here: `listDncCommand` → `GET /api/orgs/:orgId/dnc` (`search`, `limit`, `offset`):
 * `data.entries` (`id`, `phone_number`, `reason`, `source` — manual | csv | opt_out | …,
 * `created_at`) and `total`. The route does not cap `limit` itself; the CLI's `--limit` must be
 * at least 1 and `--all` asks for pages of `ALL_PAGE_SIZE`.
 * Not in here: adding (`add_dnc.ts`), removing (`remove_dnc.ts`), importing (`import_dnc.ts`).
 * Called by: `features/dnc/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, intOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { fetchPages } from '../../core/paginate.js';

export const listDncCommand: CommandSpec = {
  path: ['dnc', 'list'],
  summary: "list the org's do-not-call numbers",
  options: {
    search: { type: 'string', value: '<text>', help: 'match the number or the reason' },
    limit: { type: 'string', value: '<n>', help: 'rows per page' },
    offset: { type: 'string', value: '<n>', help: 'skip this many rows first' },
    all: { type: 'boolean', help: 'fetch every page' },
  },
  async run(ctx) {
    const v = ctx.values;
    const path = await ctx.orgPath('/dnc');
    const page = await fetchPages(
      async (off, lim) => {
        const d = dataOf((await ctx.api().get(path, { query: { search: stringOption(v, 'search'), offset: off, limit: lim } })).body) as {
          entries?: unknown;
          total?: unknown;
        } | null;
        return { items: Array.isArray(d?.entries) ? (d.entries as unknown[]) : [], total: typeof d?.total === 'number' ? d.total : null };
      },
      { offset: intOption(v, 'offset', 0) ?? 0, limit: intOption(v, 'limit', 1), all: boolOption(v, 'all') },
    );
    return {
      data: page.items,
      defaultFields: ['id', 'phone_number', 'reason', 'source', 'created_at'],
      notes: page.nextOffset !== null ? [{ more: { total: page.total, nextOffset: page.nextOffset } }] : [],
    };
  },
};
