/**
 * sub_accounts.test.mjs — phase 4e: sub-accounts (`telenow sub-accounts …`, `/api/v1/sub-accounts`).
 *
 * Covers:
 * - create refuses before sending:
 *   - no name, no key role, no spend limit (or `--no-limit`), a limit with `--no-limit`;
 *   - no place for the key, a profile name in use, a key file already there;
 *   - a limit that is not an amount.
 * - create:
 *   - the body (limits as exact decimal text, the role);
 *   - NO Idempotency-Key, and `--idempotency-key` is not an option;
 *   - the key saved as a profile (on this server, the sub-account as its org, NOT made current, and
 *     it really works) or in a new owner-only file;
 *   - the secret never on stdout or stderr, `--output raw` included, unless `--show-key`;
 *   - an `--external-id` retry refused (409), not doubled.
 * - list (query names, short view), get, usage (window; a bad instant comes back 400).
 * - update: only what is given; `none` clears a limit; `--clear-external-id`; nothing to change refused.
 * - suspend asks with the live call count; resume.
 * - rotate-key:
 *   - asks, and always sends `revokeExisting`;
 *   - the old key then stops working;
 *   - `--keep-existing` asks nothing and keeps it.
 * - close asks ("cannot be undone"); the numbers refusal comes through; then every key is revoked.
 * - A viewer key is refused (exit 2) even for the list.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, VIEWER_KEY, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

let mock;
let sb;
before(async () => {
  mock = await startMock();
  sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
});
after(async () => {
  sb.cleanup();
  await mock.close();
});
beforeEach(() => {
  const s = mock.state;
  for (const k of Object.keys(s.keys)) if (k.startsWith('vai_live_sub_')) delete s.keys[k];
  s.subs = {};
  s.subCreates = [];
  s.subLive = {};
  s.subEnded = {};
  s.subNumbers = {};
  mock.requests.length = 0;
});

const cfg = () => JSON.parse(readFileSync(sb.configFile, 'utf8'));
const subPosts = () => mock.requests.filter((r) => r.path.startsWith('/api/v1/sub-accounts') && r.method !== 'GET');
const secrets = () => Object.keys(mock.state.keys).filter((k) => k.startsWith('vai_live_sub_'));
const leaks = (r) => secrets().some((k) => r.out.includes(k) || r.err.includes(k));
const create = (extra = []) => ['sub-accounts', 'create', '--name', 'Acme Clinic', '--key-role', 'developer', '--monthly-limit', '50', ...extra];

test('create refuses before sending anything', async () => {
  writeFileSync(join(sb.home, 'taken.key'), 'x');
  const cases = [
    [['sub-accounts', 'create', '--key-role', 'admin', '--no-limit', '--show-key'], /--name is required/],
    [['sub-accounts', 'create', '--name', 'A', '--no-limit', '--show-key'], /--key-role is required/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--show-key'], /spends from your wallet/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--max-concurrent', '3', '--show-key'], /spends from your wallet/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--monthly-limit', '5', '--no-limit', '--show-key'], /not both/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--no-limit'], /say where the new key goes/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--no-limit', '--save-profile', 'default'], /already exists/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--no-limit', '--key-file', 'taken.key'], /already exists/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--monthly-limit', 'fifty', '--show-key'], /amount in USD/],
    [['sub-accounts', 'create', '--name', 'A', '--key-role', 'admin', '--no-limit', '--show-key', '--idempotency-key', 'abcdefgh1'], /idempotency-key/],
  ];
  for (const [argv, msg] of cases) {
    const r = await sb.run(argv);
    assert.equal(r.code, 1, argv.join(' '));
    assert.match(r.errors[0].error.message, msg, argv.join(' '));
  }
  assert.equal(mock.state.subCreates.length, 0);
});

test('create --save-profile: exact body, no Idempotency-Key, the key saved (not current) and working, never printed', async () => {
  const r = await sb.run(create(['--total-limit', '1200.50', '--max-concurrent', '2', '--external-id', 'cust-1', '--save-profile', 'acme']));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(mock.state.subCreates[0], {
    name: 'Acme Clinic',
    keyRole: 'developer',
    externalId: 'cust-1',
    limits: { monthlySpendLimitUsd: '50', totalSpendLimitUsd: '1200.50', maxConcurrentCalls: 2 },
  });
  assert.equal(subPosts()[0].headers['idempotency-key'], undefined);
  const id = r.json.subAccount.id;
  assert.deepEqual(r.json.savedTo, { profile: 'acme' });
  assert.equal(r.json.apiKey.role, 'developer');
  assert.ok(!('key' in r.json.apiKey));
  assert.equal(leaks(r), false, 'the secret is in no output');
  const c = cfg();
  assert.equal(c.currentProfile, 'default');
  assert.equal(c.profiles.acme.apiKey, secrets()[0]);
  assert.equal(c.profiles.acme.orgId, id);
  assert.equal(c.profiles.acme.baseUrl, mock.url);
  assert.equal(statSync(sb.configFile).mode & 0o777, 0o600);
  const who = await sb.run(['whoami', '--profile', 'acme']);
  assert.equal(who.code, 0, who.err);
  assert.equal(who.json.org_id, id);
  const again = await sb.run(create(['--external-id', 'cust-1', '--save-profile', 'acme2']));
  assert.equal(again.code, 4, 'a retry with the same external id is refused, not doubled');
  assert.equal(Object.keys(mock.state.subs).length, 1);
});

test('create --key-file: a new owner-only file; --output raw never shows the secret; --show-key does', async () => {
  let r = await sb.run(create(['--key-file', 'acme.key', '--output', 'raw']));
  assert.equal(r.code, 0, r.err);
  const file = join(sb.home, 'acme.key');
  assert.equal(readFileSync(file, 'utf8'), secrets()[0] + '\n');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(leaks(r), false);
  assert.ok(r.out.includes('"lastFour"'));
  r = await sb.run(['sub-accounts', 'create', '--name', 'Shown', '--key-role', 'viewer', '--no-limit', '--show-key']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.key, secrets()[1]);
  assert.equal(mock.state.subCreates.at(-1).limits, undefined, '--no-limit sends no limits');
});

test('list, get, usage', async () => {
  const id = (await sb.run(create(['--external-id', 'cust-7', '--show-key']))).json.subAccount.id;
  mock.state.subLive[id] = 2;
  let r = await sb.run(['sub-accounts', 'list', '--status', 'active', '--external-id', 'cust-7']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(mock.requests.at(-1).query, { status: 'active', externalId: 'cust-7', offset: '0' });
  assert.deepEqual(Object.keys(r.json[0]).sort(), ['externalId', 'id', 'limits', 'name', 'status', 'usage']);
  r = await sb.run(['sub-accounts', 'get', id]);
  assert.equal(r.json.usage.activeCalls, 2);
  r = await sb.run(['sub-accounts', 'usage', id, '--from', '2026-11-01T00:00:00+05:30', '--to', '2026-11-08T00:00:00Z']);
  assert.equal(r.code, 0, r.err);
  assert.equal(mock.requests.at(-1).query.from, '2026-11-01T00:00:00+05:30', 'the + arrives intact');
  r = await sb.run(['sub-accounts', 'usage', id, '--from', 'yesterday']);
  assert.equal(r.code, 1);
  r = await sb.run(['sub-accounts', 'get', 'nope']);
  assert.equal(r.code, 3);
});

test('update sends only what is given; none clears a limit; nothing to change is refused', async () => {
  const id = (await sb.run(create(['--external-id', 'x1', '--show-key']))).json.subAccount.id;
  mock.requests.length = 0;
  let r = await sb.run(['sub-accounts', 'update', id]);
  assert.equal(r.code, 1);
  r = await sb.run(['sub-accounts', 'update', id, '--external-id', 'a', '--clear-external-id']);
  assert.equal(r.code, 1);
  assert.equal(subPosts().length, 0);
  r = await sb.run(['sub-accounts', 'update', id, '--monthly-limit', 'none', '--clear-external-id']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(subPosts()[0].body, { externalId: null, limits: { monthlySpendLimitUsd: null } });
  assert.equal(r.json.limits.monthlySpendLimitUsd, null);
  r = await sb.run(['sub-accounts', 'update', id, '--name', 'Renamed']);
  assert.deepEqual(subPosts()[1].body, { name: 'Renamed' });
});

test('suspend asks with the live calls; resume', async () => {
  const id = (await sb.run(create(['--show-key']))).json.subAccount.id;
  mock.state.subLive[id] = 2;
  let r = await sb.run(['sub-accounts', 'suspend', id, '--reason', 'unpaid']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /Suspending Acme Clinic: its 2 live calls end now/);
  assert.equal(mock.state.subs[id].status, 'active');
  r = await sb.run(['sub-accounts', 'suspend', id, '--reason', 'unpaid', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.status, 'suspended');
  assert.deepEqual(subPosts().at(-1).body, { reason: 'unpaid' });
  assert.equal(mock.state.subEnded[id], 2);
  r = await sb.run(['sub-accounts', 'resume', id]);
  assert.equal(r.json.status, 'active');
});

test('rotate-key asks and always sends revokeExisting; the old key stops working; --keep-existing keeps it', async () => {
  await sb.run(create(['--save-profile', 'old']));
  const id = cfg().profiles.old.orgId;
  let r = await sb.run(['sub-accounts', 'rotate-key', id, '--save-profile', 'new']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /--key-role is required/);
  r = await sb.run(['sub-accounts', 'rotate-key', id, '--key-role', 'admin', '--save-profile', 'new']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /every key it has now stops working at once/);
  assert.equal((await sb.run(['whoami', '--profile', 'old'])).code, 0);
  r = await sb.run(['sub-accounts', 'rotate-key', id, '--key-role', 'admin', '--save-profile', 'new', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(subPosts().at(-1).body, { keyRole: 'admin', revokeExisting: true });
  assert.equal(subPosts().at(-1).headers['idempotency-key'], undefined);
  assert.equal(r.json.revokedKeys, 1);
  assert.equal(leaks(r), false);
  assert.equal((await sb.run(['whoami', '--profile', 'old'])).code, 2, 'the old key no longer works');
  assert.equal((await sb.run(['whoami', '--profile', 'new'])).code, 0);
  r = await sb.run(['sub-accounts', 'rotate-key', id, '--key-role', 'viewer', '--keep-existing', '--key-file', 'extra.key']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(subPosts().at(-1).body, { keyRole: 'viewer', revokeExisting: false });
  assert.equal((await sb.run(['whoami', '--profile', 'new'])).code, 0, '--keep-existing kept it');
  assert.ok(existsSync(join(sb.home, 'extra.key')));
});

test('close asks (cannot be undone); the numbers refusal comes through; then every key is revoked', async () => {
  await sb.run(create(['--save-profile', 'closing']));
  const id = cfg().profiles.closing.orgId;
  let r = await sb.run(['sub-accounts', 'close', id]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /Closing Acme Clinic for good: this cannot be undone; it revokes all its keys/);
  mock.state.subNumbers[id] = 2;
  r = await sb.run(['sub-accounts', 'close', id, '--yes']);
  assert.equal(r.code, 4);
  assert.match(r.errors[0].error.message, /Release this sub-account's 2 phone number/);
  mock.state.subNumbers[id] = 0;
  r = await sb.run(['sub-accounts', 'close', id, '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.status, 'closed');
  assert.equal((await sb.run(['whoami', '--profile', 'closing'])).code, 2);
  r = await sb.run(['sub-accounts', 'close', id, '--dry-run']);
  assert.equal(r.json.request.method, 'DELETE');
});

test('a viewer key is refused, even for the list', async () => {
  const r = await sb.run(['sub-accounts', 'list'], { env: { TELENOW_API_KEY: VIEWER_KEY } });
  assert.equal(r.code, 2);
  assert.match(r.errors[0].error.message, /requires one of: owner, admin/);
});
