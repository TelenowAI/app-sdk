/**
 * line_diff.test.mjs — the unified diff `prompts diff` prints.
 *
 * Covers: equal texts give nothing; one changed line; a pure insertion and a pure deletion get
 * the `-N,0` / `+N,0` hunk headers `diff -u` writes; changes far apart become two hunks; a
 * final-newline-only difference is said in words. Applying each diff's `+` side gives the new
 * text back.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { unifiedDiff } from '../../dist/cli/core/line_diff.js';

const L = { old: 'a', new: 'b' };
const lines = (n, f = (i) => `l${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

test('equal texts give an empty diff', () => {
  assert.equal(unifiedDiff('x\ny\n', 'x\ny\n', L), '');
});

test('one changed line', () => {
  assert.equal(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', L), '--- a\n+++ b\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
});

test('insertion into and deletion from an empty side', () => {
  assert.equal(unifiedDiff('', 'x\n', L), '--- a\n+++ b\n@@ -0,0 +1,1 @@\n+x\n');
  assert.equal(unifiedDiff('x\n', '', L), '--- a\n+++ b\n@@ -1,1 +0,0 @@\n-x\n');
});

test('changes far apart are two hunks with 3 lines of context', () => {
  const a = lines(20);
  const b = lines(20, (i) => (i === 2 || i === 18 ? `L${i}` : `l${i}`));
  const d = unifiedDiff(a, b, L);
  assert.deepEqual(d.split('\n').filter((l) => l.startsWith('@@')), ['@@ -1,5 +1,5 @@', '@@ -15,6 +15,6 @@']);
});

test('the + and context lines rebuild the new text', () => {
  const a = lines(30);
  const b = lines(30, (i) => (i % 7 === 0 ? `changed ${i}` : `l${i}`)).replace('l3\n', 'l3\nextra\n');
  const d = unifiedDiff(a, b, { old: 'a', new: 'b' });
  // With hunks covering every change, the old text with each hunk applied is the new text.
  const old = a.split('\n').slice(0, -1);
  const out = [];
  let at = 0;
  for (const h of d.split('@@ ').slice(1)) {
    const [head, ...body] = h.split('\n');
    const start = Number(head.match(/^-(\d+)/)[1]);
    while (at < start - 1) out.push(old[at++]);
    for (const l of body) {
      if (l.startsWith(' ')) {
        out.push(l.slice(1));
        at++;
      } else if (l.startsWith('-')) at++;
      else if (l.startsWith('+')) out.push(l.slice(1));
    }
  }
  while (at < old.length) out.push(old[at++]);
  assert.equal(out.join('\n') + '\n', b);
});

test('only the final newline differs', () => {
  assert.match(unifiedDiff('x', 'x\n', L), /only the newline at the end differs/);
});
