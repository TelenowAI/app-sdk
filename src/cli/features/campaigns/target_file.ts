/**
 * target_file.ts — read and check a file of people to call before any of it is sent.
 *
 * In here: `readTargetFile` → `{ kind: 'csv', rows, path }` or `{ kind: 'json', targets, path }`.
 * - CSV: the server reads it naively — the first line is the header and must name a
 *   `phone_number` or `phone` column, rows are split on every comma, and every other column
 *   becomes a text variable. Quoted fields are NOT understood there (a comma inside quotes would
 *   shift every column after it, silently), so a file with a double quote is refused here.
 * - JSON: an array — or `{ "targets": [...] }` — of `{ phoneNumber (or phone), id?, variables? }`.
 *   `id` is your own id for the person: a re-sent row with the same id is skipped as a duplicate,
 *   which makes a retried add safe.
 * Every phone number must be E.164 (`core/phone_number.ts`); the server would otherwise drop a
 * number with no digits without counting it anywhere. All bad rows are listed by line / index.
 * Not in here: sending (`add_targets.ts`).
 * Called by: `add_targets.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { CliError, EXIT } from '../../core/cli_error.js';
import { e164 } from '../../core/phone_number.js';

export interface JsonTarget {
  phoneNumber: string;
  id?: string;
  variables?: Record<string, unknown>;
}

export type TargetFile =
  | { kind: 'csv'; path: string; rows: number }
  | { kind: 'json'; path: string; targets: JsonTarget[] };

function valid(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    e164(raw, 'number');
    return true;
  } catch {
    return false;
  }
}

function readCsv(path: string, text: string): TargetFile {
  if (text.includes('"')) {
    throw new CliError(
      `${path} contains double quotes: the server's CSV reader does not understand quoted fields, so columns would shift. ` +
        'Remove the quotes (and any commas inside values), or use a .json file.',
      EXIT.usage,
    );
  }
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  const col = header.findIndex((h) => h === 'phone_number' || h === 'phone');
  if (col < 0) throw new CliError(`${path}: the first line must name a phone_number (or phone) column`, EXIT.usage);
  const bad: number[] = [];
  let rows = 0;
  lines.slice(1).forEach((line, i) => {
    if (line.trim() === '') return;
    rows++;
    if (!valid(line.split(',')[col]?.trim())) bad.push(i + 2);
  });
  if (rows === 0) throw new CliError(`${path} has no rows after its header`, EXIT.usage);
  if (bad.length > 0) {
    throw new CliError(`${path}: ${bad.length} row(s) have a phone number that is not + country code digits`, EXIT.usage, {
      details: { badLines: bad },
    });
  }
  return { kind: 'csv', path, rows };
}

function readJson(path: string, text: string): TargetFile {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new CliError(`${path} is not valid JSON: ${(e as Error).message}`, EXIT.usage);
  }
  const list = Array.isArray(v) ? v : (v as { targets?: unknown } | null)?.targets;
  if (!Array.isArray(list) || list.length === 0) throw new CliError(`${path} must hold a non-empty array of people (or { "targets": [...] })`, EXIT.usage);
  const bad: number[] = [];
  const targets: JsonTarget[] = [];
  list.forEach((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const phone = r.phoneNumber ?? r.phone;
    if (!valid(phone)) {
      bad.push(i);
      return;
    }
    const t: JsonTarget = { phoneNumber: e164(phone as string, 'number') };
    if (r.id !== undefined) t.id = String(r.id);
    if (r.variables && typeof r.variables === 'object' && !Array.isArray(r.variables)) t.variables = r.variables as Record<string, unknown>;
    targets.push(t);
  });
  if (bad.length > 0) {
    throw new CliError(`${path}: ${bad.length} item(s) have no phoneNumber in + country code form`, EXIT.usage, {
      details: { badIndexes: bad },
    });
  }
  return { kind: 'json', path, targets };
}

export function readTargetFile(cwd: string, file: string | undefined): TargetFile {
  if (!file) throw new CliError('--file is required: a .csv or .json file of people to call', EXIT.usage);
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new CliError(`no such file: ${path}`, EXIT.usage);
  const text = readFileSync(path, 'utf8');
  const ext = extname(path).toLowerCase();
  if (ext === '.csv') return readCsv(path, text);
  if (ext === '.json') return readJson(path, text);
  throw new CliError(`${path}: use a .csv or a .json file`, EXIT.usage);
}
