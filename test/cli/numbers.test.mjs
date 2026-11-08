/**
 * numbers.test.mjs — phase 4c: phone numbers (`telenow numbers …`).
 *
 * Covers:
 * - The reads: get (short view; a released number is 404), providers, renewal-risk, reclaimable,
 *   requirements (the query names; the carrier's raw detail left out), search (the query names, a
 *   bad --match refused, the carrier as a note).
 * - assign: sent without asking when nothing moves; asks (needs_yes) when it takes the number
 *   from another agent or clears a setting, naming each; nothing sent when it is already that
 *   agent's (the server would clear its settings).
 * - unassign: nothing sent without an agent; asks otherwise; the server's pool refusal.
 * - default-outbound always sends isDefault explicitly.
 * - inbound-action: exactly one of --action / --clear (null); the server's 409.
 * - buy (D3):
 *   - the search is run again and must contain the exact number (exit 3 otherwise; never bought);
 *   - no rent → refused;
 *   - the question shows the price and the monthly renewal; nothing bought without a yes;
 *   - the purchase carries the search's prices, the carrier that answered, and an
 *     Idempotency-Key (a retry with the same key buys once);
 *   - a missing setup fee is said, never sent as 0;
 *   - --dry-run searches but never buys.
 * - release: asks, "cannot be undone and nothing is refunded" (or "stays yours" for BYOC), the agent
 *   named; the server's WhatsApp 409.
 * - reclaim: only a listed number, with its old price in the question; keyed.
 * - A viewer key cannot change anything (exit 2).
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, VIEWER_KEY, agentRow, startMock } from './mock_server.mjs';
import { numberRow } from './mock_numbers.mjs';
import { makeSandbox } from './run_cli.mjs';

const A1 = 'a0000000-0000-4000-8000-0000000000d1';
const A2 = 'a0000000-0000-4000-8000-0000000000d2';
const FREE = 'n0000000-0000-4000-8000-000000000001';
const TAKEN = 'n0000000-0000-4000-8000-000000000002';
const BYOC = 'n0000000-0000-4000-8000-000000000003';
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
  s.agents = { [A1]: agentRow(A1, { name: 'Support' }), [A2]: agentRow(A2, { name: 'Sales' }) };
  s.numbers = [
    numberRow(FREE, '+14155550100'),
    numberRow(TAKEN, '+14155550101', { agent_id: A1, is_default_outbound: true }),
    numberRow(BYOC, '+14155550102', { source: 'byoc', agent_id: A2 }),
  ];
  s.inventory = [
    { e164: '+14155550199', region: 'CA', number_type: 'local', monthly_rent: '1.15', setup_price: '0.50', capabilities: { voice: true } },
    { e164: '+14155550188', region: 'CA', number_type: 'local', monthly_rent: null, setup_price: null, capabilities: { voice: true } },
    { e164: '+918000000001', provider: 'exotel', region: 'KA', number_type: 'mobile', monthly_rent: '500', capabilities: { voice: true } },
  ];
  s.reclaimable = [{ id: 'lost-1', e164: '+14155550177', provider: 'plivo', reclaimDeadlineAt: '2026-11-12T00:00:00Z', releaseReason: 'non_payment', lastMonthlyRent: '1.15', lastSetupPrice: '0', priceCurrency: 'USD', lastMonthlyRentUsd: '1.1500', lastSetupPriceUsd: '0.0000' }];
  s.purchases = [];
  s.numIdem = {};
  s.whatsappNumbers = [];
  s.spendBlocked = false;
  s.reclaims = 0;
  mock.requests.length = 0;
});

const writes = () => mock.requests.filter((r) => r.method !== 'GET');

test('numbers get, providers, renewal-risk, reclaimable', async () => {
  let r = await sb.run(['numbers', 'get', FREE]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.e164, '+14155550100');
  assert.equal(r.json.price_currency, 'USD');
  assert.ok(!('released_at' in r.json), 'short view');
  mock.state.numbers[0].released_at = '2026-11-01T00:00:00Z';
  r = await sb.run(['numbers', 'get', FREE]);
  assert.equal(r.code, 3);
  r = await sb.run(['numbers', 'providers']);
  assert.deepEqual(r.json.map((p) => p.id), ['plivo', 'exotel']);
  assert.deepEqual(r.errors[0], { default: 'plivo' });
  r = await sb.run(['numbers', 'renewal-risk']);
  assert.equal(r.json.mode, 'prepaid');
  r = await sb.run(['numbers', 'reclaimable']);
  assert.equal(r.json[0].id, 'lost-1');
});

test('numbers requirements: the query names; raw left out; a carrier without it answers 400', async () => {
  let r = await sb.run(['numbers', 'requirements', '--country', 'DE']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /--type, --end-user/);
  r = await sb.run(['numbers', 'requirements', '--country', 'DE', '--type', 'local', '--end-user', 'business']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(mock.requests.at(-1).query, { country: 'DE', type: 'local', endUserType: 'business' });
  assert.ok(!('raw' in r.json[0]));
  r = await sb.run(['numbers', 'requirements', '--country', 'IN', '--type', 'mobile', '--end-user', 'business', '--provider', 'exotel']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /does not support compliance/);
});

test('numbers search: the query names, the short view, the carrier as a note; --match checked; country required', async () => {
  let r = await sb.run(['numbers', 'search', '--country', 'US', '--pattern', '415', '--match', 'starts', '--type', 'local', '--region', 'CA', '--limit', '5']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(mock.requests.at(-1).query, { country: 'US', pattern: '415', match: 'starts', type: 'local', region: 'CA', limit: '5' });
  assert.equal(r.json.length, 2);
  assert.ok(!('raw' in r.json[0]));
  assert.deepEqual(r.errors[0], { provider: 'plivo' });
  r = await sb.run(['numbers', 'search', '--country', 'US', '--match', 'somewhere']);
  assert.equal(r.code, 1);
  r = await sb.run(['numbers', 'search']);
  assert.equal(r.code, 1);
  r = await sb.run(['numbers', 'search', '--country', 'US', '--provider', 'closed']);
  assert.equal(r.code, 2);
});

test('numbers assign: no question when nothing moves; asks, naming each change, when it does; nothing sent when already that agent\'s', async () => {
  let r = await sb.run(['numbers', 'assign', FREE, '--agent', A1]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(writes()[0].body, { agentId: A1 });
  assert.equal(r.json.agent_id, A1);

  mock.requests.length = 0;
  mock.state.numbers[1].inbound_action = null;
  r = await sb.run(['numbers', 'assign', TAKEN, '--agent', A2]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'needs_yes');
  assert.match(r.errors[0].error.message, /taken from Support \(a0000000-0000-4000-8000-0000000000d1\)/);
  assert.match(r.errors[0].error.message, /stops being a default number for outbound calls/);
  assert.equal(writes().length, 0);
  r = await sb.run(['numbers', 'assign', TAKEN, '--agent', A2, '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.agent_id, A2);

  mock.requests.length = 0;
  r = await sb.run(['numbers', 'assign', TAKEN, '--agent', A2]);
  assert.equal(r.code, 0);
  assert.equal(writes().length, 0, 'already this agent\'s: nothing sent');
  assert.match(r.errors[0].note, /already this agent's/);

  mock.state.numbers[0].agent_id = null;
  mock.state.numbers[0].inbound_action = 'forward';
  r = await sb.run(['numbers', 'assign', FREE, '--agent', A1]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /inbound action \(forward\) is cleared/);
  r = await sb.run(['numbers', 'assign', FREE]);
  assert.equal(r.code, 1);
});

test('numbers unassign: nothing sent without an agent; asks otherwise; the pool refusal comes through', async () => {
  let r = await sb.run(['numbers', 'unassign', FREE]);
  assert.equal(r.code, 0);
  assert.equal(writes().length, 0);
  r = await sb.run(['numbers', 'unassign', TAKEN]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /Support .* stops answering calls to \+14155550101 now; it also stops being a default number/);
  assert.equal(writes().length, 0);
  r = await sb.run(['numbers', 'unassign', TAKEN, '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.agent_id, null);
  mock.state.numbers[2].is_pool = true;
  r = await sb.run(['numbers', 'unassign', BYOC, '--yes']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /pool number/);
});

test('numbers default-outbound sends isDefault explicitly; inbound-action needs exactly one of --action / --clear', async () => {
  let r = await sb.run(['numbers', 'default-outbound', BYOC]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(writes()[0].body, { isDefault: true });
  r = await sb.run(['numbers', 'default-outbound', BYOC, '--off']);
  assert.deepEqual(writes()[1].body, { isDefault: false });
  assert.equal(r.json.is_default_outbound, false);

  mock.requests.length = 0;
  for (const argv of [['numbers', 'inbound-action', FREE], ['numbers', 'inbound-action', FREE, '--action', 'speak', '--clear']]) {
    r = await sb.run(argv);
    assert.equal(r.code, 1);
  }
  assert.equal(writes().length, 0);
  r = await sb.run(['numbers', 'inbound-action', FREE, '--action', 'forward']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(writes()[0].body, { action: 'forward' });
  r = await sb.run(['numbers', 'inbound-action', FREE, '--clear']);
  assert.deepEqual(writes()[1].body, { action: null });
  assert.equal(r.json.inbound_action, null);
  r = await sb.run(['numbers', 'inbound-action', TAKEN, '--action', 'reject']);
  assert.equal(r.code, 4);
});

test('numbers buy: the search must still offer the exact number, with a rent; nothing bought without a yes', async () => {
  let r = await sb.run(['numbers', 'buy', '+14155550111', '--country', 'US']);
  assert.equal(r.code, 3);
  assert.equal(r.errors[0].error.code, 'not_offered');
  r = await sb.run(['numbers', 'buy', '+14155550188', '--country', 'US']);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'no_price');
  r = await sb.run(['numbers', 'buy', '+1 415 555 0199', '--country', 'US', '--pattern', '415']);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'needs_yes');
  assert.match(r.errors[0].error.message, /Buying \+14155550199 \(local, CA\) from plivo: setup 0\.50 USD and the first month 1\.15 USD are charged to your account now, and it renews every month until you release it/);
  r = await sb.run(['numbers', 'buy', 'not-a-number', '--country', 'US', '--yes']);
  assert.equal(r.code, 1);
  assert.equal(mock.state.purchases.length, 0);
  assert.ok(!writes().some((w) => w.path.endsWith('/purchase')));
});

test("numbers buy --yes: the search's prices and carrier, keyed; a retry with the key buys once; --dry-run never buys", async () => {
  let r = await sb.run(['numbers', 'buy', '+14155550199', '--country', 'US', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.request.path, '/api/voice/numbers/purchase');
  assert.equal(r.json.price.monthlyRent, '1.15');
  assert.equal(mock.state.purchases.length, 0);

  r = await sb.run(['numbers', 'buy', '+14155550199', '--country', 'US', '--yes', '--idempotency-key', 'buy-0199-once']);
  assert.equal(r.code, 0, r.err);
  const sent = writes().find((w) => w.path.endsWith('/purchase'));
  assert.deepEqual(sent.body, { number: '+14155550199', extras: { monthlyRent: '1.15', setupPrice: '0.50', numberType: 'local' }, provider: 'plivo' });
  assert.equal(sent.headers['idempotency-key'], 'buy-0199-once');
  assert.equal(r.json.number.e164, '+14155550199');
  assert.deepEqual(r.json.price, { provider: 'plivo', currency: 'USD', setupPrice: '0.50', monthlyRent: '1.15', setupPriceUsd: '0.5000', monthlyRentUsd: '1.1500' });
  assert.ok(!r.errors.some((e) => /answered from the first request/.test(e.note ?? '')));
  r = await sb.run(['numbers', 'buy', '+14155550199', '--country', 'US', '--yes', '--idempotency-key', 'buy-0199-once']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.errors[0].note, /answered from the first request.*nothing was done again/);
  assert.equal(mock.state.numbers.filter((n) => n.e164 === '+14155550199').length, 1);
  assert.equal(mock.state.purchases.length, 1, 'the retry was answered from the first purchase');
});

test('numbers buy in another currency: USD beside it; a missing setup fee is said, never sent as 0', async () => {
  const r = await sb.run(['numbers', 'buy', '+918000000001', '--country', 'IN', '--provider', 'exotel']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /the first month 500 INR \(about 6\.0000 USD\) are charged/);
  assert.match(r.errors[0].error.message, /the carrier states no setup fee/);
  const ok = await sb.run(['numbers', 'buy', '+918000000001', '--country', 'IN', '--provider', 'exotel', '--yes']);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(mock.state.purchases[0].extras, { monthlyRent: '500', numberType: 'mobile' });
  assert.equal(mock.state.purchases[0].provider, 'exotel');
});

test('numbers release: asks, says it cannot be undone (or stays yours for BYOC), names the agent; WhatsApp 409', async () => {
  let r = await sb.run(['numbers', 'release', TAKEN]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /\+14155550101 goes back to plivo for good: this cannot be undone and nothing is refunded; Support .* stops answering it/);
  assert.equal(writes().length, 0);
  r = await sb.run(['numbers', 'release', BYOC]);
  assert.match(r.errors[0].error.message, /stays yours at your own carrier/);
  r = await sb.run(['numbers', 'release', TAKEN, '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { id: TAKEN, e164: '+14155550101', released: true });
  assert.ok(mock.state.numbers[1].released_at);
  mock.state.whatsappNumbers = [FREE];
  r = await sb.run(['numbers', 'release', FREE, '--yes']);
  assert.equal(r.code, 4);
  assert.match(r.errors[0].error.message, /WhatsApp/);
  mock.requests.length = 0;
  r = await sb.run(['numbers', 'release', FREE, '--dry-run']);
  assert.equal(r.json.request.method, 'DELETE');
  assert.equal(mock.requests.length, 0);
});

test('numbers reclaim: only a listed number; its old price in the question; keyed', async () => {
  let r = await sb.run(['numbers', 'reclaim', 'released-by-me', '--yes']);
  assert.equal(r.code, 3);
  assert.equal(r.errors[0].error.code, 'not_reclaimable');
  assert.equal(writes().length, 0);
  r = await sb.run(['numbers', 'reclaim', 'lost-1']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /it was 1\.15 USD a month; it is bought again at the carrier's price today/);
  r = await sb.run(['numbers', 'reclaim', 'lost-1', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.status, 'restored');
  assert.equal(r.json.chargedUsd, '1.1500');
  assert.match(writes().at(-1).headers['idempotency-key'], /^[0-9a-f-]{36}$/);
});

test('a viewer key cannot change a number (exit 2)', async () => {
  const env = { TELENOW_API_KEY: VIEWER_KEY };
  let r = await sb.run(['numbers', 'default-outbound', BYOC], { env });
  assert.equal(r.code, 2);
  r = await sb.run(['numbers', 'release', FREE, '--yes'], { env });
  assert.equal(r.code, 2);
  assert.ok(!mock.state.numbers[0].released_at);
  r = await sb.run(['numbers', 'get', FREE], { env });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.id, FREE, 'a viewer key still reads');
});
