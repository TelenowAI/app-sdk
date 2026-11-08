/**
 * confirm_rule.test.mjs — the rule for commands that dial, spend, send or delete (plan §6.1),
 * exercised through `agents delete`.
 *
 * Covers: without a terminal and without --yes it refuses (exit 1, `needs_yes`) and sends
 * nothing; in a terminal, a typed `yes` goes ahead and anything else cancels; --yes goes ahead;
 * --dry-run neither asks nor sends; the question names the agent.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, agentRow, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const ID = 'e0000000-0000-4000-8000-000000000001';
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
  mock.state.agents[ID] = agentRow(ID, { name: 'Billing Bot' });
});
const deletes = () => mock.requests.filter((r) => r.method === 'DELETE').length;

test('no terminal and no --yes: refused, nothing sent', async () => {
  const n = deletes();
  const r = await sb.run(['agents', 'delete', ID], { tty: false });
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'needs_yes');
  assert.match(r.errors[0].error.message, /Billing Bot/);
  assert.equal(deletes(), n);
  assert.ok(mock.state.agents[ID]);
});

test('in a terminal: "yes" goes ahead, anything else cancels', async () => {
  let n = deletes();
  let r = await sb.run(['agents', 'delete', ID], { tty: true, stdin: 'no\n' });
  assert.equal(r.code, 1);
  assert.equal(r.errors.at(-1).error.code, 'cancelled');
  assert.match(r.err, /Delete agent "Billing Bot"/);
  assert.equal(deletes(), n);
  r = await sb.run(['agents', 'delete', ID], { tty: true, stdin: '' });
  assert.equal(r.code, 1, 'an empty answer (closed input) must cancel');
  assert.equal(deletes(), n);
  r = await sb.run(['agents', 'delete', ID], { tty: true, stdin: 'yes\n' });
  assert.equal(r.code, 0, r.err);
  assert.equal(deletes(), n + 1);
  assert.equal(mock.state.agents[ID], undefined);
});

test('--yes goes ahead without asking', async () => {
  const r = await sb.run(['agents', 'delete', ID, '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.deleted, true);
});

test('--dry-run neither asks nor sends', async () => {
  const n = mock.requests.length;
  const r = await sb.run(['agents', 'delete', ID, '--dry-run']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.request, { method: 'DELETE', path: `/api/agents/${ID}`, headers: {} });
  assert.equal(mock.requests.length, n);
});
