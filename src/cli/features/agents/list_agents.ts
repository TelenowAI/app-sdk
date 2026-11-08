/**
 * list_agents.ts — `telenow agents list`: the org's agents, one page or `--all`.
 *
 * In here: `listAgentsCommand` → `GET /api/agents` (`limit`, `offset`, `search`, `status`,
 * `kind`, `isActive`). It prints a short view by default — an agent row carries its whole
 * prompt and provider settings, far more than a list needs — and the whole rows with `--full`;
 * `--fields` picks from the whole rows either way. When more pages exist, a note on stderr says
 * where the next one starts.
 * Not in here: one agent (`get_agent.ts`), paging rules (`core/paginate.ts`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, intOption, oneOf, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { fetchPages } from '../../core/paginate.js';

/** The short view: who the agent is and what it runs on. */
const SHORT_VIEW = ['id', 'name', 'description', 'is_active', 'llm_model', 'tts_voice', 'updated_at'];

export const listAgentsCommand: CommandSpec = {
  path: ['agents', 'list'],
  summary: "list the org's agents",
  options: {
    limit: { type: 'string', value: '<n>', help: 'rows per page (the server caps it)' },
    offset: { type: 'string', value: '<n>', help: 'skip this many rows first' },
    all: { type: 'boolean', help: 'fetch every page' },
    search: { type: 'string', value: '<text>', help: 'match the name' },
    status: { type: 'string', value: '<draft|published>', help: 'draft = has unpublished dashboard changes' },
    kind: { type: 'string', value: '<flow|single>', help: 'flow agents or single-prompt agents' },
    active: { type: 'string', value: '<true|false>', help: 'enabled or disabled agents' },
    full: { type: 'boolean', help: 'print whole agent rows, not the short view' },
  },
  async run(ctx) {
    const v = ctx.values;
    const query = {
      search: stringOption(v, 'search'),
      status: oneOf(v, 'status', ['draft', 'published'] as const),
      kind: oneOf(v, 'kind', ['flow', 'single'] as const),
      isActive: oneOf(v, 'active', ['true', 'false'] as const),
    };
    const offset = intOption(v, 'offset', 0) ?? 0;
    const page = await fetchPages(
      async (off, lim) => {
        const d = dataOf((await ctx.api().get('/api/agents', { query: { ...query, offset: off, limit: lim } })).body) as {
          agents?: unknown;
          total?: unknown;
        } | null;
        return {
          items: Array.isArray(d?.agents) ? (d.agents as unknown[]) : [],
          total: typeof d?.total === 'number' ? d.total : null,
        };
      },
      { offset, limit: intOption(v, 'limit', 1), all: boolOption(v, 'all') },
    );
    return {
      data: page.items,
      defaultFields: boolOption(v, 'full') ? undefined : SHORT_VIEW,
      notes: page.nextOffset !== null ? [{ more: { total: page.total, nextOffset: page.nextOffset } }] : [],
    };
  },
};
