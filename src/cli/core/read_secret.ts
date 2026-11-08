/**
 * read_secret.ts — read an API key without it ever showing on screen or in shell history.
 *
 * In here: `promptHidden` (asks on stderr, reads a terminal in raw mode, echoes nothing) and
 * `readAllStdin` (for `telenow login --key-stdin`, e.g. `printf %s "$KEY" | telenow login
 * --key-stdin`). There is deliberately no `--api-key <value>` flag: a flag's value lands in
 * shell history and in `ps`.
 * Not in here: checking or saving the key (`features/auth/login.ts`).
 * Called by: `features/auth/login.ts`.
 */

import { CliError, EXIT } from './cli_error.js';
import type { WritableLike } from './command_spec.js';

interface RawInput extends NodeJS.ReadableStream {
  setRawMode?(mode: boolean): unknown;
}

const ENTER = new Set(['\r', '\n', '\u0004']); // Enter, Ctrl-D
const CTRL_C = '\u0003';
const BACKSPACE = new Set(['\u007f', '\b']);

export function promptHidden(question: string, input: NodeJS.ReadableStream, output: WritableLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const tty = input as RawInput;
    let buf = '';
    const cleanup = () => {
      tty.removeListener('data', onData);
      tty.setRawMode?.(false);
      tty.pause();
      output.write('\n');
    };
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString()) {
        if (ENTER.has(ch)) {
          cleanup();
          resolve(buf);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          reject(new CliError('cancelled', EXIT.usage));
          return;
        }
        if (BACKSPACE.has(ch)) buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    output.write(question);
    tty.setRawMode?.(true);
    tty.on('data', onData);
    tty.resume();
  });
}

export async function readAllStdin(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of input) chunks.push(chunk.toString());
  return chunks.join('');
}
