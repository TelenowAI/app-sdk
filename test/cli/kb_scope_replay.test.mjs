/**
 * kb_scope_replay.test.mjs — phase 4d: which documents of a knowledge base an agent answers from, and
 * replaying a webhook delivery.
 *
 * Covers:
 * - kb attach:
 *   - `--doc` sends exactly `{ documentIds }` and reads the scope back;
 *   - a new base with no `--doc` is whole;
 *   - no `--doc` on a scoped base is refused (it would change nothing);
 *   - `--whole` widens it with a PUT that keeps every other base as it was, and a difference after
 *     the PUT is reported;
 *   - asking for what is already there sends nothing;
 *   - `--doc` with `--whole` is refused;
 *   - the server's "not in this base" comes through;
 *   - `--dry-run` sends nothing.
 * - kb attached: each base with `document_ids`.
 * - webhooks replay:
 *   - the question names the event, its time, its status and the endpoint's host, and never the
 *     payload;
 *   - nothing is sent without a yes;
 *   - the Idempotency-Key is always sent, and a retry with the same key is answered `deduplicated`;
 *   - the server's coded refusals come through (not finished, replays off, a developer key);
 *   - an unknown webhook stops before asking.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, ORG_ID, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const AGENT = 'agentkb1';
const DEV_KEY = 'vai_live_test_developer_key';
let mock;
let sb;
before(async () => {
  mock = await startMock();
  mock.state.keys[DEV_KEY] = { org_id: ORG_ID, org_name: 'Acme', key_id: 'k3', key_name: 'dev', key_role: 'developer', parent_org_id: null };
  sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
});
after(async () => {
  sb.cleanup();
  await mock.close();
});
beforeEach(() => {
  const s = mock.state;
  s.kbs = {
    kbA: { id: 'kbA', name: 'Pricing', docs: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] },
    kbB: { id: 'kbB', name: 'Policies', docs: [{ id: 'p1' }, { id: 'p2' }] },
    kbC: { id: 'kbC', name: 'FAQ', docs: [{ id: 'f1' }] },
  };
  s.attached = new Map([
    [`${AGENT}|kbB`, ['p1']],
    [`${AGENT}|kbC`, null],
  ]);
  s.kbPuts = 0;
  s.hooks = {};
  s.hooks2 = { hookA: { id: 'hookA', url: 'https://crm.example.com/telenow/in?token=secret', events: ['call.completed'] } };
  s.deliveries2 = {
    del1: { id: 'del1', endpoint_id: 'hookA', event_type: 'call.completed', status: 'delivered', payload: { caller: '+919999999999', summary: 'private' }, created_at: '2026-11-07T10:00:00Z', delivery_kind: null },
    del2: { id: 'del2', endpoint_id: 'hookA', event_type: 'call.completed', status: 'failed', payload: {}, created_at: '2026-11-07T11:00:00Z', next_attempt_at: '2026-11-08T13:00:00Z' },
    del3: { id: 'del3', endpoint_id: 'hookA', event_type: 'call.started', status: 'dead', payload: {}, created_at: '2026-11-07T12:00:00Z', delivery_kind: 'test' },
  };
  s.replayClicks = {};
  s.replays = 0;
  s.replayOff = false;
  mock.requests.length = 0;
});

const writes = () => mock.requests.filter((r) => r.method !== 'GET');
const path = (suffix) => `/api/orgs/${ORG_ID}/agents/${AGENT}/knowledge-bases${suffix}`;

test('kb attach --doc: exactly { documentIds }, read back; a new base without --doc is whole', async () => {
  let r = await sb.run(['kb', 'attach', 'kbA', '--agent', AGENT, '--doc', 'd1', '--doc', 'd3']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(writes()[0].body, { documentIds: ['d1', 'd3'] });
  assert.equal(writes()[0].headers['content-type'], 'application/json');
  assert.deepEqual(r.json, { kbId: 'kbA', agentId: AGENT, was: null, now: { documents: 2, documentIds: ['d1', 'd3'] }, changed: true });

  mock.state.attached.delete(`${AGENT}|kbA`);
  mock.requests.length = 0;
  r = await sb.run(['kb', 'attach', 'kbA', '--agent', AGENT]);
  assert.equal(r.code, 0, r.err);
  assert.equal(writes()[0].body, undefined);
  assert.deepEqual(r.json.now, { whole: true });
});

test('kb attach without --doc on a scoped base is refused; asking for what is there sends nothing', async () => {
  let r = await sb.run(['kb', 'attach', 'kbB', '--agent', AGENT]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'scoped_attachment');
  assert.match(r.errors[0].error.message, /limited to 1 document.*--whole widens it/);
  r = await sb.run(['kb', 'attach', 'kbC', '--agent', AGENT]);
  assert.equal(r.code, 0);
  assert.equal(r.json.changed, false);
  r = await sb.run(['kb', 'attach', 'kbB', '--agent', AGENT, '--doc', 'p1']);
  assert.equal(r.json.changed, false);
  assert.equal(writes().length, 0);
  r = await sb.run(['kb', 'attach', 'kbB', '--agent', AGENT, '--doc', 'p1', '--whole']);
  assert.equal(r.code, 1);
});

test('kb attach --whole widens a scoped base with a PUT that keeps every other base as it was', async () => {
  mock.state.attached.set(`${AGENT}|kbA`, ['d2']);
  const r = await sb.run(['kb', 'attach', 'kbB', '--agent', AGENT, '--whole']);
  assert.equal(r.code, 0, r.err);
  const put = writes()[0];
  assert.equal(put.method, 'PUT');
  assert.equal(put.path, path(''));
  assert.deepEqual(
    [...put.body.knowledgeBases].sort((a, b) => a.kbId.localeCompare(b.kbId)),
    [{ kbId: 'kbA', documentIds: ['d2'] }, { kbId: 'kbB' }, { kbId: 'kbC' }],
  );
  assert.deepEqual(r.json.was, { documents: 1, documentIds: ['p1'] });
  assert.deepEqual(r.json.now, { whole: true });
  assert.deepEqual(mock.state.attached.get(`${AGENT}|kbA`), ['d2']);
  assert.equal(mock.state.attached.get(`${AGENT}|kbC`), null);
  assert.equal(r.errors.length, 0);
});

test('kb attach --whole reports a set that differs after the PUT (someone else saved)', async () => {
  mock.state.hooks.afterKbPut = (agent) => mock.state.attached.set(`${agent}|kbA`, ['d1']);
  const r = await sb.run(['kb', 'attach', 'kbB', '--agent', AGENT, '--whole']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.errors[0].warning, /not exactly what was sent/);
  assert.deepEqual(r.errors[0].differs, ['kbA']);
});

test('kb attach: the server\'s "not in this base" comes through; --dry-run sends nothing; kb attached lists the scopes', async () => {
  let r = await sb.run(['kb', 'attach', 'kbA', '--agent', AGENT, '--doc', 'p1']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /document_not_in_base: p1/);
  mock.requests.length = 0;
  r = await sb.run(['kb', 'attach', 'kbB', '--agent', AGENT, '--whole', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.request.method, 'PUT');
  assert.equal(writes().length, 0);
  r = await sb.run(['kb', 'attached', '--agent', AGENT]);
  assert.deepEqual(r.json.map((k) => [k.id, k.document_ids]), [['kbB', ['p1']], ['kbC', null]]);
});

test('webhooks replay: the question names the event, time, status and host — never the payload; nothing sent without yes', async () => {
  let r = await sb.run(['webhooks', 'replay', 'hookA', 'del1']);
  assert.equal(r.code, 1);
  const msg = r.errors[0].error.message;
  assert.match(msg, /Sending the call\.completed of 2026-11-07T10:00:00Z \(now delivered\) to crm\.example\.com again: it carries the original data, and your endpoint may act on it twice/);
  assert.ok(!msg.includes('+919999999999') && !msg.includes('token=secret'));
  assert.equal(mock.state.replays, 0);
  r = await sb.run(['webhooks', 'replay', 'hookA', 'del3']);
  assert.match(r.errors[0].error.message, /\(a test event\)/);
  r = await sb.run(['webhooks', 'replay', 'nohook', 'del1', '--yes']);
  assert.equal(r.code, 3);
  assert.match(r.errors[0].error.message, /no active webhook nohook/, 'stopped by the CLI before reading the delivery');
  assert.equal(writes().length, 0);
});

test('webhooks replay --yes: keyed; a retry with the same key is answered deduplicated (and says so); one send', async () => {
  let r = await sb.run(['webhooks', 'replay', 'hookA', 'del1', '--yes', '--idempotency-key', 'replay-del1-once']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.deduplicated, false);
  assert.equal(r.json.delivery.replayOf, 'del1');
  assert.equal(writes()[0].headers['idempotency-key'], 'replay-del1-once');
  r = await sb.run(['webhooks', 'replay', 'hookA', 'del1', '--yes', '--idempotency-key', 'replay-del1-once']);
  assert.equal(r.json.deduplicated, false, 'the first answer, given again by the idempotency layer');
  assert.match(r.errors[0].note, /answered from the first request.*nothing was done again/);
  mock.state.replayCacheGone = true;
  r = await sb.run(['webhooks', 'replay', 'hookA', 'del1', '--yes', '--idempotency-key', 'replay-del1-once']);
  assert.equal(r.json.deduplicated, true, "the service's own check, once the cache is gone");
  mock.state.replayCacheGone = false;
  assert.equal(mock.state.replays, 1);
  r = await sb.run(['webhooks', 'replay', 'hookA', 'del1', '--yes']);
  assert.match(writes().at(-1).headers['idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.equal(mock.state.replays, 2);
});

test("webhooks replay: the server's coded refusals come through", async () => {
  let r = await sb.run(['webhooks', 'replay', 'hookA', 'del2', '--yes']);
  assert.equal(r.code, 4);
  assert.equal(r.errors[0].error.code, 'webhook_delivery_not_finished');
  assert.equal(r.errors[0].error.nextAttemptAt, '2026-11-08T13:00:00Z');
  mock.state.replayOff = true;
  r = await sb.run(['webhooks', 'replay', 'hookA', 'del1', '--yes']);
  assert.equal(r.code, 6);
  assert.equal(r.errors[0].error.setting, 'WEBHOOK_MANUAL_SENDS_PER_HOUR');
  mock.state.replayOff = false;
  r = await sb.run(['webhooks', 'replay', 'hookA', 'del1', '--yes'], { env: { TELENOW_API_KEY: DEV_KEY } });
  assert.equal(r.code, 2);
  r = await sb.run(['webhooks', 'replay', 'hookA', 'del1', '--dry-run']);
  assert.equal(r.json.request.path, `/api/orgs/${ORG_ID}/webhooks/hookA/deliveries/del1/replay`);
  assert.equal(mock.state.replays, 0);
});
