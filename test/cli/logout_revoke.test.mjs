/**
 * logout_revoke.test.mjs — `telenow logout --revoke` (POST /api/v1/me/revoke), and plain logout.
 *
 * Covers: --revoke sends the PROFILE's key (not TELENOW_API_KEY's) to the profile's server with no
 * body, the key stops working, the profile is forgotten and no "still valid" note is printed; a
 * server older than the route (404) keeps the profile; a key the server no longer takes (401) is
 * forgotten with a note; another --base-url is refused before anything is sent; a 5xx keeps the
 * profile; plain logout sends nothing and keeps its note.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';

import { makeCliLoginState } from './mock_cli_login.mjs';
import { ORG_ID, VIEWER_KEY, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

let mock;
let from;
let n = 0;
before(async () => {
  mock = await startMock();
});
after(async () => {
  await mock.close();
});
beforeEach(() => {
  mock.state.cliLogin = makeCliLoginState();
  mock.state.respond = undefined;
  from = mock.requests.length;
});
const revokes = () => mock.requests.slice(from).filter((r) => r.path === '/api/v1/me/revoke');

/** A fresh key the mock knows, saved as `profile` through `login --key-stdin`. */
async function loginWithFreshKey(sb, profile = 'default') {
  const key = `vai_live_revoke_test_${++n}`;
  mock.state.keys[key] = { org_id: ORG_ID, org_name: 'Acme', key_id: `kr${n}`, key_name: `cli ${n}`, key_role: 'developer', parent_org_id: null };
  const r = await sb.run(['login', '--key-stdin', '--profile', profile], { stdin: key });
  assert.equal(r.code, 0, r.err);
  from = mock.requests.length;
  return key;
}

test('logout --revoke revokes the profile key on its server, then forgets the profile', async () => {
  const sb = makeSandbox(mock.url);
  const key = await loginWithFreshKey(sb);
  // TELENOW_API_KEY is another key: it must be neither sent nor revoked.
  const r = await sb.run(['logout', '--revoke'], { env: { TELENOW_API_KEY: VIEWER_KEY } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { removed: 'default', currentProfile: null, revoked: true, keyId: `kr${n}` });
  const [req] = revokes();
  assert.equal(revokes().length, 1);
  assert.equal(req.method, 'POST');
  assert.equal(req.headers['x-api-key'], key);
  assert.equal(req.body, undefined);
  assert.equal(mock.state.keys[key], undefined, 'the key no longer works on the server');
  assert.ok(mock.state.keys[VIEWER_KEY], "TELENOW_API_KEY's key is untouched");
  assert.deepEqual(JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles, {});
  assert.doesNotMatch(r.err, /still valid/);
  const who = await sb.run(['whoami'], { env: { TELENOW_API_KEY: key } });
  assert.equal(who.code, 2);
  sb.cleanup();
});

test('a server older than the revoke route (404): exit 3, the profile is kept', async () => {
  const sb = makeSandbox(mock.url);
  const key = await loginWithFreshKey(sb);
  mock.state.cliLogin.routes = false;
  const r = await sb.run(['logout', '--revoke']);
  assert.equal(r.code, 3);
  const e = r.errors.at(-1).error;
  assert.equal(e.code, 'revoke_unavailable');
  assert.match(e.message, /cannot revoke a key from the CLI yet \(the server is older\); revoke it in the dashboard/);
  assert.equal(JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles.default.apiKey, key);
  assert.ok(mock.state.keys[key]);
  sb.cleanup();
});

test('a key the server no longer takes (401) is forgotten, with a note', async () => {
  const sb = makeSandbox(mock.url);
  const key = await loginWithFreshKey(sb);
  delete mock.state.keys[key];
  const r = await sb.run(['logout', '--revoke']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.revoked, false);
  assert.match(r.errors.at(-1).note, /no longer accepted this key/);
  assert.deepEqual(JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles, {});
  sb.cleanup();
});

test('--revoke with another server is refused before anything is sent; a 5xx keeps the profile', async () => {
  const sb = makeSandbox(mock.url);
  const key = await loginWithFreshKey(sb);
  let r = await sb.run(['logout', '--revoke', '--base-url', 'https://other.example']);
  assert.equal(r.code, 1);
  assert.match(r.errors.at(-1).error.message, /only to the server it was saved for/);
  assert.equal(revokes().length, 0);
  assert.equal(sb.blocked.length, 0);

  mock.state.respond = (rec) => (rec.path === '/api/v1/me/revoke' ? { status: 500, body: { success: false, error: 'boom' } } : undefined);
  r = await sb.run(['logout', '--revoke']);
  assert.equal(r.code, 6);
  assert.equal(JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles.default.apiKey, key);
  sb.cleanup();
});

test('plain logout sends nothing, forgets the profile and says the key is still valid', async () => {
  const sb = makeSandbox(mock.url);
  const key = await loginWithFreshKey(sb);
  const r = await sb.run(['logout']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { removed: 'default', currentProfile: null });
  assert.equal(mock.requests.length, from);
  assert.match(r.err, /still valid on the server/);
  assert.ok(mock.state.keys[key]);
  sb.cleanup();
});
