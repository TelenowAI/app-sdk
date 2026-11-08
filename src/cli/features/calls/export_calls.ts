/**
 * export_calls.ts — `telenow calls export --out <file> [filters]`: the org's calls as a CSV file.
 *
 * In here: `exportCallsCommand` → `GET /api/orgs/:orgId/calls/export`, streamed to `--out`
 * (mode 600, never over an existing file without `--force`).
 * - The filters have the same names as `calls list`, plus channel, disposition, campaign and
 *   call mode.
 * - `--columns a,b` picks the columns; `telenow calls export-columns` lists them. The server
 *   refuses an unknown one.
 * - The days in `--from` / `--to` are read in `--tz`, by default this computer's zone. The
 *   server's own default zone is not the person's.
 * - With no dates, the server exports the last 30 days.
 * - The server builds the file in memory and stops at a row limit (lower with wide columns).
 *   It says so in `x-export-*` headers, which are printed: `truncated`, and then the rows kept
 *   and the total. `columns` is "N-of-M".
 * - Two exports at once get 429; the client waits as the server asks and tries again.
 * Not in here: the call list (`list_calls.ts`), the column list (`export_columns.ts`).
 * Called by: `features/calls/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { oneOf, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { downloadToFile } from '../../core/download_file.js';
import { timeZoneFor, TZ_OPTION } from '../../core/local_timezone.js';
import { FORCE_OPTION, outOption, outputTarget } from '../../core/output_file.js';
import { CALL_SORTS } from './list_calls.js';

function intHeader(h: Headers, name: string): number | null {
  const v = h.get(name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export const exportCallsCommand: CommandSpec = {
  path: ['calls', 'export'],
  summary: "save the org's calls as a CSV file",
  options: {
    out: outOption('the CSV'),
    from: { type: 'string', value: '<YYYY-MM-DD>', help: 'started on or after this day' },
    to: { type: 'string', value: '<YYYY-MM-DD>', help: 'started on or before this day' },
    tz: TZ_OPTION,
    agent: { type: 'string', value: '<agent-id>', help: "only this agent's calls" },
    status: { type: 'string', value: '<status>', help: 'e.g. active, ended' },
    channel: { type: 'string', value: '<channel>', help: 'e.g. telephony, web_call (see export-columns)' },
    number: { type: 'string', value: '<digits>', help: 'either side of the call matches (comma-separated for several)' },
    caller: { type: 'string', value: '<digits>', help: "the caller's number contains these digits" },
    disposition: { type: 'string', value: '<value>', help: "the carrier's final status of the call" },
    campaign: { type: 'string', value: '<campaign-id>', help: 'only calls this campaign placed' },
    'call-mode': { type: 'string', value: '<mode>', help: 'agent or manual' },
    sort: { type: 'string', value: '<order>', help: 'newest (default), oldest, longest or shortest' },
    columns: { type: 'string', value: '<a,b>', help: 'the columns to write (default: the standard set)' },
    force: FORCE_OPTION,
  },
  async run(ctx) {
    const target = outputTarget(ctx);
    if (!target) throw new CliError('--out <file> is required: an export is a CSV file', EXIT.usage);
    const v = ctx.values;
    const query = {
      from: stringOption(v, 'from'),
      to: stringOption(v, 'to'),
      tz: timeZoneFor(ctx),
      agentId: stringOption(v, 'agent'),
      status: stringOption(v, 'status'),
      channel: stringOption(v, 'channel'),
      number: stringOption(v, 'number'),
      caller: stringOption(v, 'caller'),
      disposition: stringOption(v, 'disposition'),
      campaignId: stringOption(v, 'campaign'),
      callMode: stringOption(v, 'call-mode'),
      sort: oneOf(v, 'sort', CALL_SORTS),
      fields: stringOption(v, 'columns'),
    };
    const got = await downloadToFile(ctx, await ctx.orgPath('/calls/export'), query, target);
    const h = got.headers;
    const truncated = h.get('x-export-truncated') === 'true';
    const disposition = h.get('content-disposition') ?? '';
    const named = /filename="([^"]*)"/.exec(disposition);
    const data = {
      savedTo: got.path,
      bytes: got.bytes,
      truncated,
      rows: intHeader(h, 'x-export-rows'),
      total: intHeader(h, 'x-export-total'),
      columns: h.get('x-export-columns'),
      timeZone: query.tz ?? null,
      serverFileName: named ? named[1] : null,
    };
    const notes: unknown[] = [];
    if (truncated) {
      notes.push({
        warning:
          `the server stopped at ${data.rows ?? '?'} of ${data.total ?? '?'} calls (its limit for one file); ` +
          'narrow --from / --to, or pick fewer wide columns',
      });
    }
    return { data, notes };
  },
};
