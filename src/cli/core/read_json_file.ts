/**
 * read_json_file.ts — `--file x.json` for commands that send a JSON body.
 *
 * In here: `FILE_OPTION` and `readJsonObject` (the file must hold one JSON object; `-` reads
 * stdin, so `cat agent.json | telenow agents create --file -` works). A missing file, bad JSON
 * or a non-object is a usage error naming the file.
 * Not in here: what the object means (each command).
 * Called by: `agents create`, `agents update`, `campaigns create`, `flows validate`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CliError, EXIT } from './cli_error.js';
import type { CommandContext, OptionSpec } from './command_spec.js';
import { readAllStdin } from './read_secret.js';

export const FILE_OPTION: OptionSpec = { type: 'string', value: '<path|->', help: 'JSON file with the body (- reads stdin)' };

export async function readJsonObject(ctx: CommandContext, file: string | undefined, what: string): Promise<Record<string, unknown>> {
  if (file === undefined) throw new CliError(`--file is required: a JSON file with ${what}`, EXIT.usage);
  let text: string;
  if (file === '-') {
    text = await readAllStdin(ctx.io.stdin);
  } else {
    const path = resolve(ctx.cwd, file);
    if (!existsSync(path)) throw new CliError(`no such file: ${path}`, EXIT.usage);
    text = readFileSync(path, 'utf8');
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new CliError(`${file === '-' ? 'stdin' : file} is not valid JSON: ${(e as Error).message}`, EXIT.usage);
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new CliError(`${file === '-' ? 'stdin' : file} must hold one JSON object (${what})`, EXIT.usage);
  }
  return v as Record<string, unknown>;
}
