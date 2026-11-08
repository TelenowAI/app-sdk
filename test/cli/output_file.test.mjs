/**
 * output_file.test.mjs — the file writer behind every `--out` (core/output_file.ts), on its own.
 *
 * Covers what the command tests cannot reach through a real HTTP answer:
 * - a body shorter than the size the sender announced is refused, and nothing is left behind
 *   (fetch normally fails such a body first; this is the second line);
 * - a file that appears between the `--out` check and the write is never replaced without
 *   `--force`, and the `.part` file is removed;
 * - with `force` it is replaced; the result is owner-only (mode 600).
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { writeOutputFile } from '../../dist/cli/core/output_file.js';

const dir = mkdtempSync(join(tmpdir(), 'telenow-out-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('a body shorter than announced is refused and leaves nothing', async () => {
  const path = join(dir, 'short.bin');
  await assert.rejects(writeOutputFile({ path, force: false }, 'abc', { expectedBytes: 10 }), (e) => {
    assert.equal(e.exitCode, 7);
    assert.match(e.message, /3 of 10 bytes/);
    return true;
  });
  assert.deepEqual(readdirSync(dir), []);
});

test('a file that appeared meanwhile is kept unless force; force replaces it, owner-only', async () => {
  const path = join(dir, 'there.txt');
  writeFileSync(path, 'mine');
  await assert.rejects(writeOutputFile({ path, force: false }, 'theirs'), (e) => e.code === 'file_exists');
  assert.equal(readFileSync(path, 'utf8'), 'mine');
  assert.deepEqual(readdirSync(dir), ['there.txt']);

  const w = await writeOutputFile({ path, force: true }, 'theirs');
  assert.equal(w.bytes, 6);
  assert.equal(readFileSync(path, 'utf8'), 'theirs');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ['there.txt']);
});
