/**
 * print_output.ts — turn what a command returns into the text written to stdout.
 *
 * In here: `CommandOutput` (what a command returns), `OutputMode`, `checkOutputMode` and
 * `renderOutput` (json / table / raw, after `--fields`).
 * Not in here: errors and notes on stderr (`main.ts`), the projection itself
 * (`pick_fields.ts`).
 * Called by: `main.ts`; commands build a `CommandOutput`.
 *
 * Modes:
 *   json  (default) `data`, projected to --fields (else the command's `defaultFields`), as
 *         indented JSON
 *   raw   the server's whole answer (`raw`, else `data`), with no projection
 *   table `data` as columns: --fields, else `defaultFields`, else the first row's scalar fields
 * A command that returns `text` (a transcript, a diff) prints it as it is.
 */

import { CliError, EXIT } from './cli_error.js';
import { pickFields } from './pick_fields.js';

export type OutputMode = 'json' | 'table' | 'raw';

export interface CommandOutput {
  data?: unknown;
  /** The server's answer as received, for `--output raw`. */
  raw?: unknown;
  /** Printed as-is, instead of `data`. */
  text?: string;
  /**
   * The fields shown when --fields is not given (a list command's short view; `--full` on the
   * command leaves it unset). `--fields` always picks from the whole `data`.
   */
  defaultFields?: string[];
  /** Printed to stderr as JSON lines (pages left, server warnings), unless --quiet. */
  notes?: unknown[];
}

const MODES: OutputMode[] = ['json', 'table', 'raw'];

export function checkOutputMode(raw: string | undefined): OutputMode {
  const m = (raw ?? 'json') as OutputMode;
  if (!MODES.includes(m)) throw new CliError(`--output must be one of ${MODES.join(', ')}`, EXIT.usage);
  return m;
}

export function renderOutput(out: CommandOutput, mode: OutputMode, fields?: string[]): string {
  if (out.text !== undefined) return out.text.endsWith('\n') ? out.text : out.text + '\n';
  if (mode === 'raw') return JSON.stringify(out.raw ?? out.data ?? null, null, 2) + '\n';
  const pick = fields ?? out.defaultFields;
  const data = pick ? pickFields(out.data, pick) : out.data;
  if (mode === 'table') return renderTable(data, pick);
  return JSON.stringify(data ?? null, null, 2) + '\n';
}

function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).replace(/\s+/g, ' ');
}

function getPath(row: unknown, path: string): unknown {
  let cur: unknown = row;
  for (const seg of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function renderTable(data: unknown, columns?: string[]): string {
  const rows: unknown[] = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return '';
  const first = rows[0];
  const cols =
    columns && columns.length > 0
      ? columns
      : first && typeof first === 'object'
        ? Object.entries(first as Record<string, unknown>)
            .filter(([, v]) => v === null || typeof v !== 'object')
            .map(([k]) => k)
        : ['value'];
  const cells = rows.map((r) => cols.map((c) => cell(c === 'value' && (typeof r !== 'object' || r === null) ? r : getPath(r, c))));
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((row) => row[i].length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(cols), ...cells.map(line)].join('\n') + '\n';
}
