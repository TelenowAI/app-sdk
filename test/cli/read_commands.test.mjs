/**
 * read_commands.test.mjs — agents, calls, numbers and the output options.
 *
 * Covers: short view vs --full vs --fields; --output table / raw; a "more pages" note on
 * stderr and --all walking every page; calls use the key's own org; the transcript as text;
 * a 404 / 403 maps to its exit code.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { GOOD_KEY, ORG_ID, agentRow, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

let mock;
let sb;
before(async () => {
  mock = await startMock();
  for (let i = 0; i < 5; i++) {
    const id = `a${i}000000-0000-4000-8000-00000000000${i}`;
    mock.state.agents[id] = agentRow(id);
  }
  mock.state.calls = [
    {
      id: 'c1',
      agent_name: 'Support',
      status: 'ended',
      direction: 'inbound',
      channel: 'phone_inbound',
      from_number: '+911',
      to_number: '+912',
      start_time: '2026-11-07T10:00:00Z',
      duration_sec: 42,
      disposition: 'resolved',
      resp_ms_avg: 900,
      transcript: [
        { role: 'assistant', text: 'Hello,\nhow can I help?', at: 't0', agent_id: 'x' },
        { role: 'user', text: 'Where is my order?', at: 't1', agent_id: null },
      ],
      participants: { x: 'Support' },
    },
    {
      id: 'c2',
      agent_name: 'Support',
      status: 'ended',
      transcript: [
        { role: 'assistant', text: 'Hi', agent_id: 'x' },
        { role: 'assistant', text: 'Billing here', agent_id: 'y' },
      ],
      participants: { x: 'Support', y: 'Billing' },
    },
  ];
  mock.state.numbers = [{ id: 'n1', phone_number: '+91 80 0000 0000' }];
  sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
});
after(async () => {
  sb.cleanup();
  await mock.close();
});

test('agents list prints the short view; --full the whole rows; --fields picks from whole rows', async () => {
  let r = await sb.run(['agents', 'list']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.length, 5);
  assert.deepEqual(Object.keys(r.json[0]).sort(), ['description', 'id', 'is_active', 'llm_model', 'name', 'tts_voice', 'updated_at']);
  assert.ok(!('system_prompt' in r.json[0]));
  r = await sb.run(['agents', 'list', '--full']);
  assert.ok('system_prompt' in r.json[0]);
  r = await sb.run(['agents', 'list', '--fields', 'id,metadata.tools.name']);
  assert.deepEqual(r.json[0], { id: r.json[0].id, metadata: { tools: [{ name: 'lookup_order' }] } });
});

test('one page says where the next starts; --all walks every page', async () => {
  let r = await sb.run(['agents', 'list', '--limit', '2']);
  assert.equal(r.json.length, 2);
  assert.deepEqual(r.errors[0], { more: { total: 5, nextOffset: 2 } });
  r = await sb.run(['agents', 'list', '--limit', '2', '--all', '--quiet']);
  assert.equal(r.json.length, 5);
  assert.equal(r.err, '');
  const pages = mock.requests.filter((q) => q.path === '/api/agents').slice(-3);
  assert.deepEqual(pages.map((q) => q.query.offset), ['0', '2', '4']);
});

test('--limit must be a whole number', async () => {
  const r = await sb.run(['agents', 'list', '--limit', 'ten']);
  assert.equal(r.code, 1);
});

test('--output table and raw', async () => {
  let r = await sb.run(['agents', 'list', '--output', 'table', '--fields', 'name,is_active']);
  assert.equal(r.code, 0);
  assert.match(r.out.split('\n')[0], /^name\s+is_active$/);
  r = await sb.run(['agents', 'get', Object.keys(mock.state.agents)[0], '--output', 'raw']);
  assert.equal(r.json.success, true);
  r = await sb.run(['agents', 'list', '--output', 'yaml']);
  assert.equal(r.code, 1);
});

test('calls list uses the key\'s own org and the short view', async () => {
  const r = await sb.run(['calls', 'list', '--agent', 'abc', '--sort', 'longest']);
  assert.equal(r.code, 0, r.err);
  const q = mock.requests.at(-1);
  assert.equal(q.path, `/api/orgs/${ORG_ID}/calls`);
  assert.equal(q.query.agentId, 'abc');
  assert.equal(q.query.sort, 'longest');
  assert.ok(!('transcript' in r.json[0]) && !('resp_ms_avg' in r.json[0]));
  assert.equal(r.json[0].duration_sec, 42);
});

test('calls transcript: one line per turn; agent names only when the call changed hands', async () => {
  let r = await sb.run(['calls', 'transcript', 'c1']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'assistant: Hello, how can I help?\nuser: Where is my order?\n');
  r = await sb.run(['calls', 'transcript', 'c2']);
  assert.equal(r.out, 'assistant (Support): Hi\nassistant (Billing): Billing here\n');
  r = await sb.run(['calls', 'transcript', 'c1', '--format', 'json', '--fields', 'role']);
  assert.deepEqual(r.json, [{ role: 'assistant' }, { role: 'user' }]);
});

test('a missing call is exit 3; a mistyped command is exit 1', async () => {
  let r = await sb.run(['calls', 'get', 'nope']);
  assert.equal(r.code, 3);
  assert.equal(r.errors[0].error.status, 404);
  r = await sb.run(['calls', 'lst']);
  assert.equal(r.code, 1);
});

test('numbers list', async () => {
  const r = await sb.run(['numbers', 'list']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, [{ id: 'n1', phone_number: '+91 80 0000 0000' }]);
});
