/**
 * agents_write.test.mjs — agents create / update / versions, flows validate, agent-instructions.
 *
 * Covers: create sends an Idempotency-Key (a given one is reused, a retry is answered once) and
 * warns about snake_case keys; update sends only the file's fields, MERGES `metadata` over the
 * current one under If-Match on the version it read (`--replace-metadata` sends it as is),
 * refuses a stale `--expected-version` before sending; --dry-run sends nothing; flows validate
 * passes a good graph and exits 1 with the server's string errors; agent-instructions prints the
 * skill without its frontmatter.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, agentRow, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const ID = 'd0000000-0000-4000-8000-000000000001';
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
  mock.state.agents[ID] = agentRow(ID, { metadata: { flow: { nodes: [{ id: 'a' }] }, variables: [{ name: 'plan' }], keep: 1 } });
  mock.state.versions[ID] = 2;
});
const file = (name, obj) => {
  const p = join(sb.home, name);
  writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return p;
};
const last = (method) => mock.requests.filter((r) => r.method === method).at(-1);

test('create sends the file as the body with an Idempotency-Key; a retry with the same key is done once', async () => {
  const f = file('new.json', { name: 'New one', systemPrompt: 'Hi', tts_voice: 'x' });
  const before = Object.keys(mock.state.agents).length;
  let r = await sb.run(['agents', 'create', '--file', f, '--idempotency-key', 'retry-key-0001']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.name, 'New one');
  assert.equal(last('POST').headers['idempotency-key'], 'retry-key-0001');
  assert.deepEqual(last('POST').body, { name: 'New one', systemPrompt: 'Hi', tts_voice: 'x' });
  assert.match(r.err, /tts_voice \(send ttsVoice\)/);
  r = await sb.run(['agents', 'create', '--file', f, '--idempotency-key', 'retry-key-0001']);
  assert.equal(r.code, 0);
  assert.equal(Object.keys(mock.state.agents).length, before + 1, 'the retry must not create a second agent');
  r = await sb.run(['agents', 'create', '--file', f]);
  assert.match(last('POST').headers['idempotency-key'], /^[0-9a-f-]{36}$/);
  r = await sb.run(['agents', 'create', '--file', f, '--idempotency-key', 'bad key']);
  assert.equal(r.code, 1);
});

test('create --dry-run sends nothing; a non-object file is refused', async () => {
  const n = mock.requests.length;
  let r = await sb.run(['agents', 'create', '--file', file('a.json', { name: 'x' }), '--dry-run']);
  assert.equal(r.code, 0);
  assert.equal(r.json.request.method, 'POST');
  assert.equal(mock.requests.length, n);
  r = await sb.run(['agents', 'create', '--file', file('b.json', '[1,2]')]);
  assert.equal(r.code, 1);
  r = await sb.run(['agents', 'create', '--file', file('c.json', '{oops')]);
  assert.equal(r.code, 1);
  assert.equal(mock.requests.length, n);
});

test('update without metadata sends only the file and no precondition', async () => {
  const r = await sb.run(['agents', 'update', ID, '--file', file('p.json', { name: 'Renamed' })]);
  assert.equal(r.code, 0, r.err);
  const put = last('PUT');
  assert.deepEqual(put.body, { name: 'Renamed' });
  assert.equal(put.headers['if-match'], undefined);
  assert.equal(r.json.version, 3);
});

test('update MERGES metadata over the current one, under If-Match on the version it read', async () => {
  const r = await sb.run(['agents', 'update', ID, '--file', file('m.json', { metadata: { variables: [] } })]);
  assert.equal(r.code, 0, r.err);
  const put = last('PUT');
  assert.equal(put.headers['if-match'], '"2"');
  assert.deepEqual(put.body.metadata, { flow: { nodes: [{ id: 'a' }] }, variables: [], keep: 1 });
  assert.deepEqual(mock.state.agents[ID].metadata.flow, { nodes: [{ id: 'a' }] }, 'the flow must survive');
});

test('--replace-metadata sends the metadata as it is', async () => {
  const r = await sb.run(['agents', 'update', ID, '--file', file('m2.json', { metadata: { only: true } }), '--replace-metadata']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(last('PUT').body.metadata, { only: true });
});

test('a stale --expected-version is refused (exit 4), before sending when metadata is merged', async () => {
  const puts = mock.requests.filter((q) => q.method === 'PUT').length;
  let r = await sb.run(['agents', 'update', ID, '--file', file('m3.json', { metadata: { x: 1 } }), '--expected-version', '1']);
  assert.equal(r.code, 4);
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, puts);
  r = await sb.run(['agents', 'update', ID, '--file', file('n.json', { name: 'y' }), '--expected-version', '1']);
  assert.equal(r.code, 4);
  assert.equal(r.errors[0].error.currentVersion, 2);
});

test('update --dry-run sends nothing', async () => {
  const puts = mock.requests.filter((q) => q.method === 'PUT').length;
  const r = await sb.run(['agents', 'update', ID, '--file', file('d.json', { metadata: { x: 1 } }), '--dry-run']);
  assert.equal(r.code, 0);
  assert.equal(r.json.request.headers['If-Match'], '"2"');
  assert.equal(mock.requests.filter((q) => q.method === 'PUT').length, puts);
});

test('agents versions lists newest first', async () => {
  const r = await sb.run(['agents', 'versions', ID, '--fields', 'version']);
  assert.deepEqual(r.json, [{ version: 2 }, { version: 1 }]);
});

test('flows validate: a good graph passes; a bad one exits 1 with the string errors whole', async () => {
  let r = await sb.run(['flows', 'validate', '--file', file('g.json', { nodes: [{ id: 'a' }], edges: [] })]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.valid, true);
  assert.equal(r.json.warnings[0].message, 'step n9 is unreachable');
  r = await sb.run(['flows', 'validate', '--file', file('h.json', { metadata: { flow: { nodes: [] }, variables: [{ name: 'v' }] } })]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.errors[0].error.errors, ['flow has no nodes']);
  assert.deepEqual(last('POST').body.variables, [{ name: 'v' }]);
});

test('agent-instructions prints the skill without its frontmatter', async () => {
  const r = await sb.run(['agent-instructions']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^# Telenow CLI/);
  assert.ok(!r.out.includes('description:'));
});
