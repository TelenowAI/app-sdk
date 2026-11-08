/**
 * call_place.test.mjs — `telenow call place`: a real call, so the safety rules above all.
 *
 * Covers: no terminal and no --yes → refused, nothing dialled; the question names the number,
 * the agent and says calling hours are not checked (immediate) / says it is queued (--queue);
 * the number must be E.164 (separators dropped); --var name=value repeats; --from and
 * --from-number-id not both; --retries only with --queue; --dry-run neither asks nor dials; the
 * same --idempotency-key on a retry dials once and says so; the server's refusal (do-not-call)
 * comes back as exit 2.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, agentRow, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const AGENT = 'a1000000-0000-4000-8000-000000000001';
let mock;
let sb;
before(async () => {
  mock = await startMock();
  mock.state.agents[AGENT] = agentRow(AGENT, { name: 'Reminder Bot' });
  sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
});
after(async () => {
  sb.cleanup();
  await mock.close();
});
beforeEach(() => {
  mock.state.dialled = [];
  mock.state.dnc = [];
});
const place = (...extra) => ['call', 'place', '--agent', AGENT, '--to', '+91 98765-43210', ...extra];

test('no terminal and no --yes: refused, nothing dialled', async () => {
  const r = await sb.run(place());
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'needs_yes');
  assert.match(r.errors[0].error.message, /\+919876543210/);
  assert.match(r.errors[0].error.message, /Reminder Bot/);
  assert.match(r.errors[0].error.message, /calling hours are NOT checked/);
  assert.equal(mock.state.dialled.length, 0);
});

test('a typed yes dials, with the number in E.164 and the variables', async () => {
  const r = await sb.run(place('--var', 'name=Asha', '--var', 'due=5 Nov', '--from', '+1 (415) 555-0100'), { tty: true, stdin: 'yes\n' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.sessionId.length, 36);
  const d = mock.state.dialled[0];
  assert.equal(d.mobileNumber, '+919876543210');
  assert.equal(d.fromNumber, '+14155550100');
  assert.deepEqual(d.variables, { name: 'Asha', due: '5 Nov' });
  assert.match(r.err, /telenow calls get /);
});

test('--queue says it is queued and sends queue + maxAttempts', async () => {
  let r = await sb.run(place('--queue', '--retries', '2'));
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /Queue a call/);
  r = await sb.run(place('--queue', '--retries', '2', '--yes'));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.queued, true);
  assert.equal(mock.state.dialled[0].queue, true);
  assert.equal(mock.state.dialled[0].maxAttempts, 2);
});

test('bad input is refused before anything is sent', async () => {
  const n = mock.requests.length;
  for (const args of [
    ['call', 'place', '--agent', AGENT, '--to', '9876543210', '--yes'],
    ['call', 'place', '--agent', AGENT, '--to', '+0123456789', '--yes'],
    place('--from', '+14155550100', '--from-number-id', 'x', '--yes'),
    place('--retries', '2', '--yes'),
    place('--var', 'novalue', '--yes'),
    ['call', 'place', '--to', '+919876543210', '--yes'],
  ]) {
    const r = await sb.run(args);
    assert.equal(r.code, 1, args.join(' '));
  }
  assert.equal(mock.requests.length, n);
});

test('--dry-run neither asks nor dials', async () => {
  const n = mock.requests.length;
  const r = await sb.run(place('--dry-run'));
  assert.equal(r.code, 0);
  assert.equal(r.json.request.path, '/api/sessions/initiate-call');
  assert.equal(r.json.request.body.mobileNumber, '+919876543210');
  assert.ok(r.json.request.headers['Idempotency-Key']);
  assert.equal(mock.requests.length, n);
});

test('a retry with the same --idempotency-key dials once and says so', async () => {
  let r = await sb.run(place('--yes', '--idempotency-key', 'call-retry-0001'));
  assert.equal(r.code, 0, r.err);
  const first = r.json.sessionId;
  r = await sb.run(place('--yes', '--idempotency-key', 'call-retry-0001'));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.sessionId, first);
  assert.match(r.err, /nothing new was dialled/);
  assert.equal(mock.state.dialled.length, 1);
});

test("the server's refusal comes back as it is (do-not-call: exit 2)", async () => {
  mock.state.dnc = [{ id: 'n1', phone_number: '+919876543210' }];
  const r = await sb.run(place('--yes'));
  assert.equal(r.code, 2);
  assert.match(r.errors[0].error.message, /Do-Not-Call/);
  assert.equal(mock.state.dialled.length, 0);
});
