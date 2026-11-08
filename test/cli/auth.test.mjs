/**
 * auth.test.mjs — login, whoami, profiles, logout, and which key / server a command uses.
 *
 * Covers: a key is saved only after the server accepts it, with mode 600 and its org; the key is
 * never printed; `--key` with no terminal is refused, not hung (with no option at all, login is
 * the browser sign-in: `browser_login.test.mjs`); TELENOW_API_KEY never takes a profile's base
 * URL; plain http is refused except on loopback.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { after, before, test } from 'node:test';

import { GOOD_KEY, ORG_ID, VIEWER_KEY, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

let mock;
before(async () => {
  mock = await startMock();
});
after(async () => {
  await mock.close();
});

test('login saves a checked key with its org, owner-only, and never prints it', async () => {
  const sb = makeSandbox(mock.url);
  const r = await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY + '\n' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.orgId, ORG_ID);
  assert.equal(r.json.keyRole, 'owner');
  assert.equal(r.json.profile, 'default');
  assert.ok(!r.out.includes(GOOD_KEY) && !r.err.includes(GOOD_KEY), 'the key must not be printed');
  const saved = JSON.parse(readFileSync(sb.configFile, 'utf8'));
  assert.equal(saved.currentProfile, 'default');
  assert.equal(saved.profiles.default.apiKey, GOOD_KEY);
  assert.equal(saved.profiles.default.baseUrl, mock.url);
  assert.equal(statSync(sb.configFile).mode & 0o777, 0o600, 'config file must be readable by its owner only');
  const me = mock.requests.at(-1);
  assert.equal(me.path, '/api/v1/me');
  assert.equal(me.headers['x-api-key'], GOOD_KEY);
  assert.match(me.headers['user-agent'], /^telenow-cli\/\S+ \(node v\d+/);
  sb.cleanup();
});

test('a key the server refuses is not saved', async () => {
  const sb = makeSandbox(mock.url);
  const r = await sb.run(['login', '--key-stdin'], { stdin: 'vai_live_wrong' });
  assert.equal(r.code, 2);
  assert.equal(r.errors[0].error.status, 401);
  assert.equal(existsSync(sb.configFile), false);
  sb.cleanup();
});

test('login --key without a terminal is refused, not left waiting, and sends nothing', async () => {
  const sb = makeSandbox(mock.url);
  const before = mock.requests.length;
  const r = await sb.run(['login', '--key'], { tty: false });
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /--key-stdin/);
  assert.equal(mock.requests.length, before);
  sb.cleanup();
});

test('a key with spaces inside is refused before any request', async () => {
  const sb = makeSandbox(mock.url);
  const before = mock.requests.length;
  const r = await sb.run(['login', '--key-stdin'], { stdin: 'vai_live a b' });
  assert.equal(r.code, 1);
  assert.equal(mock.requests.length, before);
  sb.cleanup();
});

test('whoami reports the profile, the source of the key and the role', async () => {
  const sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin', '--profile', 'ro'], { stdin: VIEWER_KEY });
  const r = await sb.run(['whoami']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.profile, 'ro');
  assert.equal(r.json.keySource, 'profile');
  assert.equal(r.json.key_role, 'viewer');
  assert.ok(!r.out.includes(VIEWER_KEY));
  sb.cleanup();
});

test('not signed in is exit 2 with a hint', async () => {
  const sb = makeSandbox(mock.url);
  const r = await sb.run(['whoami']);
  assert.equal(r.code, 2);
  assert.match(r.errors[0].error.message, /telenow login/);
  sb.cleanup();
});

test('profiles list never shows a key; use switches; logout removes and moves current', async () => {
  const sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin', '--profile', 'a'], { stdin: GOOD_KEY });
  await sb.run(['login', '--key-stdin', '--profile', 'b'], { stdin: VIEWER_KEY });
  let r = await sb.run(['profiles', 'list']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.map((p) => [p.name, p.current]), [['a', false], ['b', true]]);
  assert.ok(!r.out.includes(GOOD_KEY) && !r.out.includes(VIEWER_KEY));
  r = await sb.run(['profiles', 'use', 'a']);
  assert.equal(r.code, 0);
  r = await sb.run(['whoami']);
  assert.equal(r.json.key_role, 'owner');
  r = await sb.run(['profiles', 'use', 'nope']);
  assert.equal(r.code, 3);
  r = await sb.run(['logout']);
  assert.equal(r.code, 0);
  assert.equal(r.json.removed, 'a');
  assert.equal(r.json.currentProfile, 'b');
  assert.match(r.err, /still valid on the server/);
  sb.cleanup();
});

test('TELENOW_API_KEY is used with TELENOW_BASE_URL / the default, never a profile\'s server', async () => {
  const sb = makeSandbox(mock.url);
  mkdirSync(dirname(sb.configFile), { recursive: true });
  writeFileSync(
    sb.configFile,
    JSON.stringify({ currentProfile: 'default', profiles: { default: { apiKey: 'other', baseUrl: 'https://other.example' } } }),
  );
  // With TELENOW_BASE_URL: the mock is used.
  let r = await sb.run(['whoami'], { env: { TELENOW_API_KEY: GOOD_KEY } });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.keySource, 'env');
  // Without it: the default server — which the test guard blocks — and never other.example.
  r = await sb.run(['whoami'], { env: { TELENOW_API_KEY: GOOD_KEY, TELENOW_BASE_URL: undefined } });
  assert.equal(r.code, 7);
  assert.ok(sb.blocked.length > 0);
  for (const u of sb.blocked) assert.equal(new URL(u).origin, 'https://api.telenow.ai');
  sb.cleanup();
});

test('plain http is refused except on loopback; credentials in the URL are refused', async () => {
  const sb = makeSandbox(mock.url);
  let r = await sb.run(['login', '--key-stdin', '--base-url', 'http://api.example.com'], { stdin: GOOD_KEY });
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /https/);
  r = await sb.run(['login', '--key-stdin', '--base-url', 'https://user:pw@api.example.com'], { stdin: GOOD_KEY });
  assert.equal(r.code, 1);
  assert.equal(sb.blocked.length, 0, 'nothing may be sent for a refused URL');
  sb.cleanup();
});
