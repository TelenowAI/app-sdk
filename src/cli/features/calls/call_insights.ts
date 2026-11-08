/**
 * call_insights.ts — `telenow calls insights <call-id> [--generate]`: the call's summary,
 * sentiment, topics and word counts.
 *
 * In here: `callInsightsCommand`.
 * - Without `--generate`: `GET /api/orgs/:orgId/calls/:id/insights`. The server answers 404
 *   until insights have been made for the call (and for an unknown call); the CLI adds a hint
 *   to `--generate` to that error.
 * - `--generate`: `POST` to the same path makes them now from the transcript (again, if they
 *   exist). The platform pays for that model call, not the org; it needs an owner, admin or
 *   developer key. Without a configured model the server stores the word counts only
 *   (`model: null`). `--dry-run` shows the request.
 * Not in here: the transcript (`get_transcript.ts`).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError } from '../../core/cli_error.js';
import { boolOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';

export const callInsightsCommand: CommandSpec = {
  path: ['calls', 'insights'],
  summary: "show a call's summary, sentiment and topics (--generate makes them)",
  args: ['call-id'],
  options: {
    generate: { type: 'boolean', help: 'make them now from the transcript (the platform pays, not your org)' },
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const id = ctx.args['call-id'];
    const path = await ctx.orgPath(`/calls/${encodeURIComponent(id)}/insights`);
    if (boolOption(ctx.values, 'generate')) {
      const w = await sendWrite(ctx, { method: 'POST', path });
      if (!w.sent) return { data: w.dryRun };
      return { data: dataOf(w.res.body), raw: w.res.body };
    }
    try {
      const res = await ctx.api().get(path);
      return { data: dataOf(res.body), raw: res.body };
    } catch (e) {
      if (e instanceof CliError && e.status === 404) {
        throw new CliError(e.message, e.exitCode, {
          status: e.status,
          code: e.code,
          details: { ...e.details, hint: `telenow calls insights ${id} --generate makes them now` },
        });
      }
      throw e;
    }
  },
};
