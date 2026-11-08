/**
 * login_expiry.test.mjs — "this login expired on …; run `telenow login`" on a 401 after the
 * saved key's expiry, and only then.
 *
 * Covers: a browser login whose key has expired → exit 2 `login_expired` with the day, the
 * server's message kept; another profile gets `--profile <name>` in the hint; a 401 BEFORE the
 * expiry, the same key from TELENOW_API_KEY, a key being checked by `login --key-stdin`, and the
 * profile used against another --base-url all keep the server's own message.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { makeCliLoginState } from './mock_cli_login.mjs';
import { startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

let mock;
before(async () => {
  mock = await startMock();
});
after(async () => {
  await mock.close();
});
beforeEach(() => {
  mock.state.cliLogin = makeCliLoginState();
});

/** A browser login whose key expires `days` from now; returns the saved profile. */
async function browserLogin(sb, days, profile = 'default') {
  mock.state.cliLogin.answers = ['approve'];
  mock.state.cliLogin.mint.expiresInDays = days;
  const r = await sb.run(['login', '--profile', profile]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles[profile];
}

test('a 401 after the saved expiry says the login expired, and how to sign in again', async () => {
  const sb = makeSandbox(mock.url);
  const p = await browserLogin(sb, -1);
  mock.state.keys[p.apiKey].expired = true;
  const r = await sb.run(['agents', 'list']);
  assert.equal(r.code, 2);
  const e = r.errors.at(-1).error;
  assert.equal(e.code, 'login_expired');
  assert.equal(e.status, 401);
  assert.equal(e.message, `this login expired on ${p.expiresAt.slice(0, 10)}; run \`telenow login\``);
  assert.equal(e.expiresAt, p.expiresAt);
  assert.equal(e.serverMessage, 'This API key has expired');
  sb.cleanup();
});

test('another profile is named in the hint', async () => {
  const sb = makeSandbox(mock.url);
  const p = await browserLogin(sb, -1, 'work');
  mock.state.keys[p.apiKey].expired = true;
  const r = await sb.run(['whoami', '--profile', 'work']);
  assert.equal(r.code, 2);
  assert.match(r.errors.at(-1).error.message, /; run `telenow login --profile work`$/);
  sb.cleanup();
});

test("before the expiry, from TELENOW_API_KEY, while logging in, or on another server: the server's own message", async () => {
  const sb = makeSandbox(mock.url);
  // A 401 before the expiry (the key was revoked in the dashboard).
  let p = await browserLogin(sb, 30);
  delete mock.state.keys[p.apiKey];
  let r = await sb.run(['agents', 'list']);
  assert.equal(r.code, 2);
  assert.equal(r.errors.at(-1).error.message, 'Invalid API key');

  // The expired key given through TELENOW_API_KEY carries no saved expiry.
  p = await browserLogin(sb, -1);
  mock.state.keys[p.apiKey].expired = true;
  r = await sb.run(['agents', 'list'], { env: { TELENOW_API_KEY: p.apiKey } });
  assert.equal(r.code, 2);
  assert.equal(r.errors.at(-1).error.code, 'api_key_expired');

  // `login --key-stdin` with a wrong key while the current profile has expired: about the new key.
  r = await sb.run(['login', '--key-stdin'], { stdin: 'vai_live_wrong' });
  assert.equal(r.code, 2);
  assert.equal(r.errors.at(-1).error.code, 'invalid_api_key');

  // The same profile pointed at another server: its expiry belongs to the saved one.
  const other = await startMock();
  try {
    const sb2 = makeSandbox(other.url);
    const cfg = JSON.parse(readFileSync(sb.configFile, 'utf8'));
    mkdirSync(dirname(sb2.configFile), { recursive: true });
    writeFileSync(sb2.configFile, JSON.stringify(cfg));
    r = await sb2.run(['agents', 'list']);
    assert.equal(r.code, 2);
    assert.equal(r.errors.at(-1).error.code, 'invalid_api_key');
    sb2.cleanup();
  } finally {
    await other.close();
  }
  sb.cleanup();
});
