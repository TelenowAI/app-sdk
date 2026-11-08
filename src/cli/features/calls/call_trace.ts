/**
 * call_trace.ts — `telenow calls trace <call-id> [--out <file>]`: the call's debug timeline.
 *
 * In here: `callTraceCommand` → `GET /api/orgs/:orgId/calls/:id/trace`. Owner or admin only
 * (both the key and the person who made it): the trace holds the full model context of every
 * turn. The answer can be several MB (up to the server's per-call event limit, plus what
 * happened after the call), so:
 * - without `--out` it prints a summary: whether the call was traced, how many events, whether
 *   the trace hit its limit (then the end of the call is missing), and the server's reason when
 *   there is no trace (debug mode off for the agent, or not saved yet);
 * - `--out <file>` also saves the whole answer's `data` there (mode 600, never over an existing
 *   file without `--force`).
 * `--output raw` prints the whole answer.
 * Not in here: turning debug mode on (an agent setting).
 * Called by: `features/calls/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { FORCE_OPTION, outOption, outputTarget, writeOutputFile } from '../../core/output_file.js';

interface TraceAnswer {
  data?: {
    event_count?: unknown;
    live_trace?: unknown;
    post_call_count?: unknown;
    truncated?: unknown;
    max_events?: unknown;
    schema_version?: unknown;
  } | null;
  reason?: unknown;
}

export const callTraceCommand: CommandSpec = {
  path: ['calls', 'trace'],
  summary: "show a call's debug timeline (owner or admin; --out saves it whole)",
  args: ['call-id'],
  options: { out: outOption('the whole trace (JSON)'), force: FORCE_OPTION },
  async run(ctx) {
    const id = ctx.args['call-id'];
    const target = outputTarget(ctx);
    const res = await ctx.api().get(await ctx.orgPath(`/calls/${encodeURIComponent(id)}/trace`));
    const body = (res.body ?? {}) as TraceAnswer;
    const d = body.data ?? null;
    const summary: Record<string, unknown> = {
      callId: id,
      traced: d !== null,
      liveTrace: d?.live_trace ?? false,
      eventCount: d?.event_count ?? 0,
      postCallCount: d?.post_call_count ?? null,
      truncated: d?.truncated ?? false,
      maxEvents: d?.max_events ?? null,
      schemaVersion: d?.schema_version ?? null,
    };
    if (typeof body.reason === 'string') summary.reason = body.reason;
    const notes: unknown[] = [];
    if (d?.truncated === true) {
      notes.push({ warning: 'the trace hit its event limit and stopped: the end of the call is missing from it' });
    }
    if (target && d !== null) {
      const saved = await writeOutputFile(target, JSON.stringify(d, null, 2) + '\n');
      summary.savedTo = saved.path;
      summary.bytes = saved.bytes;
    } else if (target) {
      notes.push({ note: 'nothing to save: there is no trace for this call' });
    } else if (d !== null) {
      notes.push({ next: `telenow calls trace ${id} --out trace.json` });
    }
    return { data: summary, raw: res.body, notes };
  },
};
