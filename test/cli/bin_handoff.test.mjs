/**
 * bin_handoff.test.mjs — the real `bin/telenow.mjs`, run as a process: app commands stay with
 * the app code, everything else reaches the account commands.
 *
 * Covers: `telenow` / `--help` list both kinds of commands (exit 0); an unknown command is exit
 * 1; `login --key-stdin` and `whoami` work end to end through the bin; `validate` still runs the
 * app code. Every child gets a temp HOME, a temp config file and the mock as its server.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { GOOD_KEY, ORG_ID, startMock } from './mock_server.mjs';

const BIN = fileURLToPath(new URL('../../bin/telenow.mjs', import.meta.url));
let mock;
let home;
before(async () => {
  mock = await startMock();
  home = mkdtempSync(join(tmpdir(), 'telenow-bin-test-'));
});
after(async () => {
  rmSync(home, { recursive: true, force: true });
  await mock.close();
});

function telenow(args, stdin) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, TELENOW_CONFIG: join(home, 'cfg.json'), TELENOW_BASE_URL: mock.url },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(stdin ?? '');
  });
}

test('telenow and telenow --help list account and app commands', async () => {
  for (const args of [[], ['--help']]) {
    const r = await telenow(args);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Account commands/);
    assert.match(r.out, /telenow prompts push <agent-id>/);
    assert.match(r.out, /App commands/);
    assert.match(r.out, /telenow build {13}validate, bundle \+ zip the app in this folder/);
  }
});

test('an unknown command is exit 1', async () => {
  const r = await telenow(['no-such-command']);
  assert.equal(r.code, 1);
  assert.match(r.err, /unknown command/);
});

test('login and whoami work through the bin', async () => {
  let r = await telenow(['login', '--key-stdin'], GOOD_KEY);
  assert.equal(r.code, 0, r.err);
  r = await telenow(['whoami', '--fields', 'org_id,keySource']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { keySource: 'profile', org_id: ORG_ID });
});

test('validate still runs the app code', async () => {
  const r = await telenow(['validate']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /^telenow: /m);
  assert.doesNotMatch(r.err, /unknown command/);
});
