/**
 * output_file.ts — where a command writes a file the person asked for (`--out`), safely.
 *
 * In here:
 * - `OUT_OPTION`, `FORCE_OPTION`, `OutputTarget`.
 * - `outputTarget`: reads `--out` against the working folder. It refuses a folder, a missing
 *   parent folder, and an existing file unless `--force` is given.
 * - `writeOutputFile`: writes the content to a hidden `.part` file beside the target (mode 600:
 *   these files hold calls, transcripts and voices), then puts it in place. Without `--force`
 *   the last step is a hard link, which fails if a file appeared there in the meantime, so
 *   nothing is ever overwritten by surprise. On any error the `.part` file is removed.
 * Not in here: fetching what is written (`download_file.ts`, the commands).
 * Called by: `download_file.ts`, `features/calls/call_trace.ts`.
 */

import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, linkSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { CliError, EXIT } from './cli_error.js';
import { boolOption, stringOption, type CommandContext, type OptionSpec } from './command_spec.js';

export const FORCE_OPTION: OptionSpec = { type: 'boolean', help: 'replace the --out file if it already exists' };

export function outOption(what: string): OptionSpec {
  return { type: 'string', value: '<file>', help: `write ${what} to this file` };
}

export interface OutputTarget {
  /** Absolute path of the file to write. */
  path: string;
  force: boolean;
}

/** The `--out` file, checked; `undefined` when `--out` was not given. */
export function outputTarget(ctx: CommandContext): OutputTarget | undefined {
  const raw = stringOption(ctx.values, 'out');
  if (raw === undefined) return undefined;
  if (raw.trim() === '') throw new CliError('--out needs a file name', EXIT.usage);
  const path = resolve(ctx.cwd, raw);
  const force = boolOption(ctx.values, 'force');
  const parent = dirname(path);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new CliError(`the folder for --out does not exist: ${parent}`, EXIT.usage);
  }
  if (existsSync(path)) {
    if (statSync(path).isDirectory()) throw new CliError(`--out is a folder, not a file: ${path}`, EXIT.usage);
    if (!force) throw new CliError(`${path} already exists; add --force to replace it`, EXIT.usage, { code: 'file_exists' });
  }
  return { path, force };
}

/** What `writeOutputFile` reports. */
export interface WrittenFile {
  path: string;
  bytes: number;
}

export interface WriteOptions {
  /** Runs for every piece written (the download's stall timer); throwing from it stops the write. */
  onChunk?: (bytes: number) => void;
  /** The size the sender announced; a different size fails and nothing is put in place. */
  expectedBytes?: number;
}

/** Writes `content` to the target through a `.part` file. */
export async function writeOutputFile(
  target: OutputTarget,
  content: string | Readable,
  opts: WriteOptions = {},
): Promise<WrittenFile> {
  const part = join(dirname(target.path), `.${basename(target.path)}.${randomBytes(6).toString('hex')}.part`);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      try {
        opts.onChunk?.(chunk.length);
      } catch (e) {
        done(e as Error);
        return;
      }
      done(null, chunk);
    },
  });
  const source = typeof content === 'string' ? Readable.from([Buffer.from(content, 'utf8')]) : content;
  try {
    await pipeline(source, counter, createWriteStream(part, { flags: 'wx', mode: 0o600 }));
    if (opts.expectedBytes !== undefined && opts.expectedBytes !== bytes) {
      throw new CliError(`the download ended early: ${bytes} of ${opts.expectedBytes} bytes arrived; nothing was saved`, EXIT.network);
    }
    putInPlace(part, target);
  } catch (e) {
    try {
      unlinkSync(part);
    } catch {
      // already gone, or never created
    }
    throw e;
  }
  return { path: target.path, bytes };
}

function putInPlace(part: string, target: OutputTarget): void {
  if (target.force) {
    renameSync(part, target.path);
    return;
  }
  try {
    linkSync(part, target.path);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'EEXIST') {
      throw new CliError(`${target.path} appeared while writing; add --force to replace it`, EXIT.usage, { code: 'file_exists' });
    }
    // A file system without hard links: check once more, then rename.
    if (existsSync(target.path)) {
      throw new CliError(`${target.path} appeared while writing; add --force to replace it`, EXIT.usage, { code: 'file_exists' });
    }
    renameSync(part, target.path);
    return;
  }
  unlinkSync(part);
}
