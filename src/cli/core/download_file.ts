/**
 * download_file.ts — fetch a file the server sends whole (a CSV export, a recording) into `--out`.
 *
 * In here: `downloadToFile`. It opens the GET with the API key (`ApiClient.openStream`: retried
 * until the answer starts, redirects refused), then streams the body through
 * `writeOutputFile`.
 * - If no bytes arrive for as long as one request may take (`TELENOW_TIMEOUT_MS`), the download
 *   is dropped as stalled. A slow but moving download is never cut off, however large.
 * - When the server says how long the body is (`Content-Length`) and fewer bytes arrived, it
 *   fails instead of leaving a short file.
 * Not in here: checking `--out` (`output_file.ts`); what the headers mean (the commands).
 * Called by: `features/calls/export_calls.ts`, `features/calls/call_recording.ts`.
 */

import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';

import type { QueryValue } from './api_client.js';
import { CliError, EXIT } from './cli_error.js';
import type { CommandContext } from './command_spec.js';
import { writeOutputFile, type OutputTarget } from './output_file.js';

export interface DownloadResult {
  path: string;
  bytes: number;
  /** The answer's headers (an export's row counts, the file's type). */
  headers: Headers;
}

export async function downloadToFile(
  ctx: CommandContext,
  apiPath: string,
  query: Record<string, QueryValue>,
  target: OutputTarget,
): Promise<DownloadResult> {
  const api = ctx.api();
  const { response, abort } = await api.openStream(apiPath, { query });
  const stallMs = api.timeoutMs;
  let stalled = false;
  let timer = setTimeout(onStall, stallMs);
  function onStall(): void {
    stalled = true;
    abort();
  }
  const body = response.body
    ? Readable.fromWeb(response.body as unknown as NodeWebStream<Uint8Array>)
    : Readable.from([]);
  const declared = response.headers.has('content-length') ? Number(response.headers.get('content-length')) : NaN;
  let written;
  try {
    written = await writeOutputFile(target, body, {
      expectedBytes: Number.isFinite(declared) ? declared : undefined,
      onChunk: () => {
        clearTimeout(timer);
        timer = setTimeout(onStall, stallMs);
      },
    });
  } catch (e) {
    if (stalled) {
      throw new CliError(`the download stalled: nothing arrived for ${stallMs} ms; nothing was saved`, EXIT.network);
    }
    if (e instanceof CliError) throw e;
    const msg = (e as { message?: string }).message ?? String(e);
    throw new CliError(`the download failed: ${msg}; nothing was saved`, EXIT.network);
  } finally {
    clearTimeout(timer);
  }
  return { path: written.path, bytes: written.bytes, headers: response.headers };
}
