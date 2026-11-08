/**
 * line_diff.ts — a unified diff of two texts, for `telenow prompts diff`.
 *
 * In here: `unifiedDiff` (`---`/`+++` header and `@@` hunks with `CONTEXT_LINES` of context;
 * an empty string when the texts are equal) and the line diff under it (Myers' algorithm,
 * after trimming the lines both texts share at the start and the end).
 * Not in here: what is compared (`features/prompts/diff_prompt.ts`).
 * Called by: `features/prompts/diff_prompt.ts`, `features/prompts/push_prompt.ts` (dry run).
 *
 * Memory: Myers keeps one row per edit distance, so its trace grows with the square of the
 * number of changed lines. Past `TRACE_CELL_BUDGET` cells (~100 MB) the diff gives up on
 * aligning lines and shows the changed middle as removed-then-added, which is still a correct
 * diff, only less tidy.
 */

type Op = { kind: ' ' | '-' | '+'; line: string };

/** Unchanged lines shown around each change, as `diff -u` does. */
const CONTEXT_LINES = 3;
const TRACE_CELL_BUDGET = 25_000_000;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let cells = 0;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d, off + d + 1));
    cells += 2 * d + 1;
    if (cells > TRACE_CELL_BUDGET) return null;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b);
    }
  }
  return backtrack(trace, a, b);
}

function backtrack(trace: Int32Array[], a: string[], b: string[]): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const row = trace[d];
    const k = x - y;
    const at = (kk: number) => (kk < -d || kk > d ? 0 : row[kk + d]);
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: ' ', line: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: '+', line: b[y - 1] });
      else ops.push({ kind: '-', line: a[x - 1] });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

function diffLines(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle = myers(midA, midB) ?? [
    ...midA.map((line): Op => ({ kind: '-', line })),
    ...midB.map((line): Op => ({ kind: '+', line })),
  ];
  return [
    ...a.slice(0, start).map((line): Op => ({ kind: ' ', line })),
    ...middle,
    ...a.slice(endA).map((line): Op => ({ kind: ' ', line })),
  ];
}

export function unifiedDiff(oldText: string, newText: string, labels: { old: string; new: string }): string {
  if (oldText === newText) return '';
  const ops = diffLines(splitLines(oldText), splitLines(newText));
  if (ops.every((o) => o.kind === ' ')) {
    // Same lines; only the final newline differs.
    return `--- ${labels.old}\n+++ ${labels.new}\n\\ only the newline at the end differs\n`;
  }
  const out: string[] = [`--- ${labels.old}`, `+++ ${labels.new}`];
  // Old/new line number (1-based) of every op.
  const pos: { a: number; b: number }[] = [];
  let ai = 1;
  let bi = 1;
  for (const o of ops) {
    pos.push({ a: ai, b: bi });
    if (o.kind !== '+') ai++;
    if (o.kind !== '-') bi++;
  }
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === ' ') {
      i++;
      continue;
    }
    const from = Math.max(0, i - CONTEXT_LINES);
    let to = i;
    // Extend the hunk while the next change is within 2 × context of this one.
    for (;;) {
      while (to < ops.length && ops[to].kind !== ' ') to++;
      let next = to;
      while (next < ops.length && ops[next].kind === ' ') next++;
      if (next < ops.length && next - to <= 2 * CONTEXT_LINES) to = next;
      else break;
    }
    const end = Math.min(ops.length, to + CONTEXT_LINES);
    const slice = ops.slice(from, end);
    const aCount = slice.filter((o) => o.kind !== '+').length;
    const bCount = slice.filter((o) => o.kind !== '-').length;
    const aStart = aCount === 0 ? pos[from].a - 1 : pos[from].a;
    const bStart = bCount === 0 ? pos[from].b - 1 : pos[from].b;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const o of slice) out.push(o.kind + o.line);
    i = end;
  }
  return out.join('\n') + '\n';
}
