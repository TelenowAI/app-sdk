/**
 * export_columns.ts — `telenow calls export-columns`: the columns `calls export --columns` takes.
 *
 * In here: `exportColumnsCommand` → `GET /api/orgs/:orgId/calls/columns` → `{ columns: [{ id,
 * header, wide, default, gridDefault }], maxRows, maxRowsWide, channels }`. It prints the
 * columns: `default: true` marks what an export writes when none are picked, and `wide` marks
 * the large ones that lower the row limit. The row limits and the channel names (`--channel`)
 * go to stderr as a note; `--output raw` prints all of it. The list always comes from the
 * server, never from a copy in the CLI.
 * Not in here: the export (`export_calls.ts`).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const exportColumnsCommand: CommandSpec = {
  path: ['calls', 'export-columns'],
  summary: 'list the columns a call export can write',
  async run(ctx) {
    const res = await ctx.api().get(await ctx.orgPath('/calls/columns'));
    const d = (dataOf(res.body) ?? {}) as { columns?: unknown; maxRows?: unknown; maxRowsWide?: unknown; channels?: unknown };
    return {
      data: Array.isArray(d.columns) ? d.columns : [],
      raw: res.body,
      notes: [{ limits: { maxRows: d.maxRows ?? null, maxRowsWide: d.maxRowsWide ?? null }, channels: d.channels ?? null }],
    };
  },
};
