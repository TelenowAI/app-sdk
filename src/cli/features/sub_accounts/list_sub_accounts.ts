/**
 * list_sub_accounts.ts — `telenow sub-accounts list [--status] [--external-id]`: the org's sub-accounts.
 *
 * In here: `listSubAccountsCommand` → `GET /api/v1/sub-accounts` (`status`, `externalId`, `limit`,
 * `offset`) → `{ subAccounts: [{ id, name, externalId, status, limits, …, usage: { monthToDateSpendUsd,
 * activeCalls } }], total, limit, offset }`. Short view by default, `--full` for whole rows, `--all` for
 * every page. The server checks `--status` (active, suspended or closed).
 * Not in here: one sub-account (`get_sub_account.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import { boolOption, intOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { fetchPages } from '../../core/paginate.js';
import { subPath } from './sub_account_paths.js';

const VIEW = ['id', 'name', 'externalId', 'status', 'limits', 'usage'];

export const listSubAccountsCommand: CommandSpec = {
  path: ['sub-accounts', 'list'],
  summary: "list the org's sub-accounts, with this month's spend",
  options: {
    status: { type: 'string', value: '<status>', help: 'active, suspended or closed' },
    'external-id': { type: 'string', value: '<id>', help: 'the one with your own id' },
    limit: { type: 'string', value: '<n>', help: 'rows per page (the server caps it)' },
    offset: { type: 'string', value: '<n>', help: 'skip this many rows first' },
    all: { type: 'boolean', help: 'fetch every page' },
    full: { type: 'boolean', help: 'print whole rows, not the short view' },
  },
  async run(ctx) {
    const v = ctx.values;
    const page = await fetchPages(
      async (off, lim) => {
        const b = (await ctx.api().get(subPath(), {
          query: { status: stringOption(v, 'status'), externalId: stringOption(v, 'external-id'), offset: off, limit: lim },
        })).body as { subAccounts?: unknown; total?: unknown } | null;
        return {
          items: Array.isArray(b?.subAccounts) ? (b.subAccounts as unknown[]) : [],
          total: typeof b?.total === 'number' ? b.total : null,
        };
      },
      { offset: intOption(v, 'offset', 0) ?? 0, limit: intOption(v, 'limit', 1), all: boolOption(v, 'all') },
    );
    const notes = page.nextOffset !== null ? [{ more: { total: page.total, nextOffset: page.nextOffset } }] : [];
    return { data: page.items, defaultFields: boolOption(v, 'full') ? undefined : VIEW, notes };
  },
};
