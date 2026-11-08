/**
 * write_request.ts — every command that changes something sends it through here.
 *
 * In here: `DRY_RUN_OPTION`, `IDEMPOTENCY_OPTION`, `WriteRequest`, `sendWrite` and `replayNotes`.
 * - `--dry-run` stops before anything is sent and returns the request as data: method, path,
 *   query, headers (never the API key: it is added by the client, not here) and body; a file
 *   upload is shown as its name, size and type, not its bytes.
 * - A creating POST carries an `Idempotency-Key`: `--idempotency-key <k>` when given — so a
 *   script or an AI assistant that retries the SAME command after a timeout gets the first
 *   answer back instead of a second call or campaign — else a fresh random one.
 * - EXCEPT a file upload (multipart). The server's idempotency layer buffers the whole body of a
 *   keyed request and refuses one over 5 MiB with 413 (`middleware/idempotency.rs`), while the
 *   upload routes take larger files (knowledge documents: 20 MB). So an upload goes without the
 *   key, and `--idempotency-key` with a file is refused here. (Found by the CLI-contract session,
 *   2026-11-08.) A retried upload is still safe where it matters: the campaign route suppresses
 *   numbers already pending, and the do-not-call import skips numbers already listed.
 * Not in here: the confirm rule (`confirm_action.ts`), which a command runs after a dry run
 * would have returned and before `sendWrite` sends.
 * Called by: the commands that create, change or delete.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, openAsBlob, statSync } from 'node:fs';
import { basename } from 'node:path';

import type { ApiResponse, QueryValue } from './api_client.js';
import { boolOption, stringOption, type CommandContext, type OptionSpec } from './command_spec.js';
import { CliError, EXIT } from './cli_error.js';

export const DRY_RUN_OPTION: OptionSpec = { type: 'boolean', help: 'show the request it would send; send nothing' };
export const IDEMPOTENCY_OPTION: OptionSpec = {
  type: 'string',
  value: '<key>',
  help: 'reuse this key when retrying the same command, so the server does it once',
};

export interface UploadPart {
  field: string;
  path: string;
  type?: string;
}

export interface WriteRequest {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Plain text fields of a multipart upload. */
  fields?: Record<string, string>;
  file?: UploadPart;
  headers?: Record<string, string>;
  /** A POST that creates something: gets an Idempotency-Key. */
  creates?: boolean;
  /** Drops the request when it fires (Ctrl-C during an interactive chat). */
  signal?: AbortSignal;
}

export type WriteResult = { sent: true; res: ApiResponse } | { sent: false; dryRun: Record<string, unknown> };

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,255}$/;

export function isDryRun(ctx: CommandContext): boolean {
  return boolOption(ctx.values, 'dry-run');
}

function idempotencyKey(ctx: CommandContext): string {
  const given = stringOption(ctx.values, 'idempotency-key');
  if (given === undefined) return randomUUID();
  if (!IDEMPOTENCY_KEY.test(given)) {
    throw new CliError('--idempotency-key must be 8–255 letters, digits, ".", "_", ":" or "-"', EXIT.usage);
  }
  return given;
}

/**
 * A note when the server answered a retried request from the first answer to its Idempotency-Key
 * (`Idempotent-Replay: true`): the answer is the first one, and nothing was done again. The body
 * cannot say so itself (a replayed send still reads `deduplicated: false`: it is that first body).
 */
export function replayNotes(res: ApiResponse): unknown[] {
  return res.headers.get('idempotent-replay') === 'true'
    ? [{ note: 'answered from the first request with this idempotency key; nothing was done again' }]
    : [];
}

export async function sendWrite(ctx: CommandContext, req: WriteRequest): Promise<WriteResult> {
  const headers: Record<string, string> = { ...req.headers };
  if (req.file && stringOption(ctx.values, 'idempotency-key') !== undefined) {
    throw new CliError(
      '--idempotency-key cannot be used with a file upload: the server would refuse a keyed body over 5 MiB',
      EXIT.usage,
    );
  }
  if (req.creates && req.method === 'POST' && !req.file) headers['Idempotency-Key'] = idempotencyKey(ctx);
  let fileInfo: Record<string, unknown> | undefined;
  let form: FormData | undefined;
  if (req.file) {
    if (!existsSync(req.file.path)) throw new CliError(`no such file: ${req.file.path}`, EXIT.usage);
    const size = statSync(req.file.path).size;
    fileInfo = { field: req.file.field, name: basename(req.file.path), bytes: size, type: req.file.type ?? null };
    if (!isDryRun(ctx)) {
      form = new FormData();
      for (const [k, v] of Object.entries(req.fields ?? {})) form.append(k, v);
      const blob = await openAsBlob(req.file.path, req.file.type ? { type: req.file.type } : undefined);
      form.append(req.file.field, blob, basename(req.file.path));
    }
  }
  if (isDryRun(ctx)) {
    return {
      sent: false,
      dryRun: {
        dryRun: true,
        request: {
          method: req.method,
          path: req.path,
          ...(req.query ? { query: Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== undefined)) } : {}),
          headers,
          ...(req.body !== undefined ? { body: req.body } : {}),
          ...(fileInfo ? { fields: req.fields ?? {}, file: fileInfo } : {}),
        },
      },
    };
  }
  const res = await ctx.api().send(req.method, req.path, {
    query: req.query,
    body: form ? undefined : req.body,
    form,
    headers,
    signal: req.signal,
  });
  return { sent: true, res };
}
