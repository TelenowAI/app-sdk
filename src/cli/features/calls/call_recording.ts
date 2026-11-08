/**
 * call_recording.ts — `telenow calls recording <call-id> [--out <file>] [--recording <id>]`:
 * list a call's recordings, or save one.
 *
 * In here: `callRecordingCommand`.
 * - The recordings come from `GET /api/orgs/:orgId/recordings?sessionId=<call-id>`: id, channel,
 *   type (`mime`), length, size and, for a transferred call, `source: "transfer_bridge"` on the
 *   part after the transfer.
 * - Without `--out` it lists them.
 * - With `--out` it saves one through `GET …/recordings/:id/file` with the API key (mode 600,
 *   never over an existing file without `--force`). A call with several recordings needs
 *   `--recording <id>`: a transferred call has two halves, and picking one silently would hide
 *   the other.
 * - The server always names the file `.wav`, even for an `audio/mpeg` recording. The CLI keeps
 *   the name given to `--out` and reports the real type.
 * - The `signed-url` route is not used: on a server that keeps recordings on its own disk, it
 *   returns a path that serves nothing.
 * Not in here: the streaming itself (`core/download_file.ts`).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandContext, type CommandSpec } from '../../core/command_spec.js';
import { downloadToFile } from '../../core/download_file.js';
import { FORCE_OPTION, outOption, outputTarget } from '../../core/output_file.js';

interface RecordingRow {
  id: string;
  channel?: unknown;
  mime?: unknown;
  duration_sec?: unknown;
  size_bytes?: unknown;
  created_at?: unknown;
  metadata?: { source?: unknown } | null;
}

function view(r: RecordingRow): Record<string, unknown> {
  return {
    id: r.id,
    channel: r.channel ?? null,
    mime: r.mime ?? null,
    durationSec: r.duration_sec ?? null,
    sizeBytes: r.size_bytes ?? null,
    createdAt: r.created_at ?? null,
    source: r.metadata?.source ?? null,
  };
}

async function callRecordings(ctx: CommandContext, callId: string): Promise<RecordingRow[]> {
  const res = await ctx.api().get(await ctx.orgPath('/recordings'), { query: { sessionId: callId } });
  const d = dataOf(res.body) as { recordings?: unknown } | null;
  return Array.isArray(d?.recordings) ? (d.recordings as RecordingRow[]).filter((r) => typeof r?.id === 'string') : [];
}

export const callRecordingCommand: CommandSpec = {
  path: ['calls', 'recording'],
  summary: "list a call's recordings, or save one with --out",
  args: ['call-id'],
  options: {
    out: outOption('the recording'),
    recording: { type: 'string', value: '<id>', help: 'which recording, when the call has several' },
    force: FORCE_OPTION,
  },
  async run(ctx) {
    const callId = ctx.args['call-id'];
    const target = outputTarget(ctx);
    const rows = await callRecordings(ctx, callId);
    const picked = stringOption(ctx.values, 'recording');
    if (!target) {
      const notes: unknown[] = [];
      if (rows.length === 0) notes.push({ note: 'no recording for this call (recording off, or not saved yet)' });
      else notes.push({ next: `telenow calls recording ${callId} --out call-audio${rows.length > 1 ? ' --recording <id>' : ''}` });
      return { data: rows.map(view), notes };
    }
    let row: RecordingRow | undefined;
    if (picked !== undefined) {
      row = rows.find((r) => r.id === picked);
      if (!row) throw new CliError(`recording ${picked} is not one of this call's recordings`, EXIT.notFound);
    } else if (rows.length === 1) {
      row = rows[0];
    } else if (rows.length === 0) {
      throw new CliError('this call has no recording (recording off, or not saved yet)', EXIT.notFound);
    } else {
      throw new CliError(`this call has ${rows.length} recordings; pick one with --recording <id>`, EXIT.usage, {
        details: { recordings: rows.map(view) },
      });
    }
    if (!ctx.global.quiet) {
      ctx.io.stderr.write(JSON.stringify({ downloading: view(row) }) + '\n');
    }
    const got = await downloadToFile(ctx, await ctx.orgPath(`/recordings/${encodeURIComponent(row.id)}/file`), {}, target);
    return {
      data: {
        callId,
        recordingId: row.id,
        savedTo: got.path,
        bytes: got.bytes,
        mime: got.headers.get('content-type') ?? row.mime ?? null,
        durationSec: row.duration_sec ?? null,
      },
    };
  },
};
