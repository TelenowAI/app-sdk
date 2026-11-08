/**
 * prompts.test.mjs — `prompts pull | diff | push`, the safety rules above all.
 *
 * Covers: the version is read BEFORE the agent; pull writes only prompt / flow / meta (no
 * settings, no secrets) plus a `*` .gitignore; pull refuses to overwrite unpushed edits;
 * diff; push sends If-Match with the pulled version and only what changed; a version that
 * moved is refused before or at the save (exit 4, nothing saved); an unpublished dashboard
 * draft is refused; server-found errors stop the push; --dry-run saves nothing; a flow push
 * sends the WHOLE metadata with only `flow` replaced; files from another server are refused.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, agentRow, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const ID = 'b0000000-0000-4000-8000-000000000001';
const FLOW_ID = 'f0000000-0000-4000-8000-000000000002';
const FLOW = { schema: 1, startNodeId: 'n1', nodes: [{ id: 'n1', name: 'Greet', prompt: 'Say hi' }], edges: [] };

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
  mock.state.agents[ID] = agentRow(ID, { system_prompt: 'Line one\nLine two\n' });
  mock.state.versions[ID] = 3;
  mock.state.agents[FLOW_ID] = agentRow(FLOW_ID, {
    system_prompt: 'Base prompt',
    metadata: { flow: FLOW, variables: [], tools: [{ name: 't', config: { token: '••••' } }], keepMe: { a: 1 } },
  });
  mock.state.versions[FLOW_ID] = 0;
  mock.state.hooks = {};
  mock.state.respond = undefined;
});

const dirOf = (id) => join(sb.home, '.telenow', 'agents', id);
const puts = () => mock.requests.filter((r) => r.method === 'PUT');

test('pull reads the version first, then writes only prompt + meta, and a * .gitignore', async () => {
  const start = mock.requests.length;
  const r = await sb.run(['prompts', 'pull', ID, '--force']);
  assert.equal(r.code, 0, r.err);
  const paths = mock.requests.slice(start).map((q) => q.path);
  assert.deepEqual(paths, [`/api/agents/${ID}/versions`, `/api/agents/${ID}`]);
  assert.equal(readFileSync(join(dirOf(ID), 'prompt.md'), 'utf8'), 'Line one\nLine two\n');
  assert.equal(existsSync(join(dirOf(ID), 'flow.json')), false);
  const meta = JSON.parse(readFileSync(join(dirOf(ID), 'agent.json'), 'utf8'));
  assert.equal(meta.version, 3);
  assert.equal(meta.baseUrl, mock.url);
  const metaText = readFileSync(join(dirOf(ID), 'agent.json'), 'utf8');
  for (const leak of ['llm_config', 'metadata', 'token', '••••', GOOD_KEY]) assert.ok(!metaText.includes(leak), `agent.json must not hold ${leak}`);
  assert.equal(readFileSync(join(sb.home, '.telenow', '.gitignore'), 'utf8'), '*\n');
});

test('pull refuses to overwrite edits that were never pushed; --force does', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'my unsaved edit\n');
  let r = await sb.run(['prompts', 'pull', ID]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.errors[0].error.edited, ['prompt.md']);
  assert.equal(readFileSync(join(dirOf(ID), 'prompt.md'), 'utf8'), 'my unsaved edit\n');
  r = await sb.run(['prompts', 'pull', ID, '--force']);
  assert.equal(r.code, 0);
  assert.equal(readFileSync(join(dirOf(ID), 'prompt.md'), 'utf8'), 'Line one\nLine two\n');
});

test('diff: no changes; then a unified diff of the edit', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  let r = await sb.run(['prompts', 'diff', ID]);
  assert.equal(r.out, 'no changes\n');
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Line one\nLine 2\n\n\n');
  r = await sb.run(['prompts', 'diff', ID]);
  assert.equal(r.out, '--- server: prompt (version 3)\n+++ local: prompt.md\n@@ -1,2 +1,2 @@\n Line one\n-Line two\n+Line 2\n');
  r = await sb.run(['prompts', 'diff', ID, '--format', 'json']);
  assert.equal(r.json.changed, true);
  assert.equal(r.json.serverChangedSincePull, false);
});

test('push sends If-Match with the pulled version and only the changed prompt', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'New prompt\n');
  const before = puts().length;
  const r = await sb.run(['prompts', 'push', ID]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { agentId: ID, changed: ['prompt'], saved: true, version: 4 });
  const put = puts().at(-1);
  assert.equal(puts().length, before + 1);
  assert.equal(put.headers['if-match'], '"3"');
  assert.deepEqual(put.body, { systemPrompt: 'New prompt' });
  assert.equal(mock.state.agents[ID].system_prompt, 'New prompt');
  // The next push builds on the version this one made.
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Newer prompt\n');
  const r2 = await sb.run(['prompts', 'push', ID]);
  assert.equal(r2.code, 0, r2.err);
  assert.equal(puts().at(-1).headers['if-match'], '"4"');
});

test('an editor\'s final newline is not a change', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Line one\nLine two\n\n');
  const before = puts().length;
  const r = await sb.run(['prompts', 'push', ID]);
  assert.equal(r.code, 0);
  assert.equal(r.json.saved, false);
  assert.equal(puts().length, before);
});

test('a version that moved since the pull is refused before the save (exit 4, nothing saved)', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Mine\n');
  mock.state.versions[ID] = 5; // someone saved in the dashboard
  const before = puts().length;
  const r = await sb.run(['prompts', 'push', ID]);
  assert.equal(r.code, 4);
  assert.equal(r.errors[0].error.code, 'agent_version_conflict');
  assert.equal(r.errors[0].error.currentVersion, 5);
  assert.equal(puts().length, before);
});

test('a save that lands between the check and the PUT is refused by the server (exit 4)', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Mine\n');
  mock.state.hooks.beforePut = (id) => {
    mock.state.versions[id] = 9;
    mock.state.agents[id].system_prompt = 'Theirs';
  };
  const r = await sb.run(['prompts', 'push', ID]);
  assert.equal(r.code, 4);
  assert.equal(r.errors[0].error.currentVersion, 9);
  assert.equal(mock.state.agents[ID].system_prompt, 'Theirs');
});

test('--force pushes without If-Match', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Forced\n');
  mock.state.versions[ID] = 5;
  const r = await sb.run(['prompts', 'push', ID, '--force']);
  assert.equal(r.code, 0, r.err);
  assert.equal(puts().at(-1).headers['if-match'], undefined);
});

test('an unpublished dashboard draft refuses the push; --ignore-draft overrides', async () => {
  mock.state.agents[ID].metadata = { ...mock.state.agents[ID].metadata, configDraft: { systemPrompt: 'draft' } };
  let r = await sb.run(['prompts', 'pull', ID, '--force']);
  assert.equal(r.json.hasDashboardDraft, true);
  assert.match(r.err, /unpublished/);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Mine\n');
  const before = puts().length;
  r = await sb.run(['prompts', 'push', ID]);
  assert.equal(r.code, 4);
  assert.equal(r.errors[0].error.code, 'dashboard_draft');
  assert.equal(puts().length, before);
  r = await sb.run(['prompts', 'push', ID, '--ignore-draft']);
  assert.equal(r.code, 0, r.err);
});

test('errors the server finds stop the push; warnings go to stderr', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Hello {#if {plan} == \'gold\'} VIP\n');
  const before = puts().length;
  let r = await sb.run(['prompts', 'push', ID]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'invalid_prompt');
  assert.equal(r.errors[0].error.errors[0].on, 'prompt.md');
  assert.equal(puts().length, before);
  const check = mock.requests.filter((q) => q.path === '/api/agents/prompt/validate').at(-1);
  assert.equal(check.body.kind, 'single');
  assert.deepEqual(check.body.tools, ['lookup_order']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Hello {unknown_var}\n');
  r = await sb.run(['prompts', 'push', ID]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /unknown_variable/);
});

test('--dry-run checks and shows the request, saves nothing, never shows the key', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Dry\n');
  const before = puts().length;
  const r = await sb.run(['prompts', 'push', ID, '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.dryRun, true);
  assert.deepEqual(r.json.request, { method: 'PUT', path: `/api/agents/${ID}`, headers: { 'If-Match': '"3"' }, body: { systemPrompt: 'Dry' } });
  assert.equal(puts().length, before);
  assert.ok(!r.out.includes(GOOD_KEY));
});

test('a flow push sends the whole metadata with only flow replaced, after the flow check', async () => {
  let r = await sb.run(['prompts', 'pull', FLOW_ID, '--force']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.isFlow, true);
  assert.equal(r.json.version, 0, 'an agent with no history is version 0');
  const flowPath = join(dirOf(FLOW_ID), 'flow.json');
  const edited = JSON.parse(readFileSync(flowPath, 'utf8'));
  edited.nodes[0].prompt = 'Say hello warmly';
  writeFileSync(flowPath, JSON.stringify(edited, null, 4));
  r = await sb.run(['prompts', 'push', FLOW_ID]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.changed, ['flow']);
  const put = puts().at(-1);
  assert.equal(put.headers['if-match'], '"0"');
  assert.deepEqual(Object.keys(put.body), ['metadata']);
  assert.deepEqual(put.body.metadata.keepMe, { a: 1 });
  assert.deepEqual(put.body.metadata.tools, [{ name: 't', config: { token: '••••' } }]);
  assert.equal(put.body.metadata.flow.nodes[0].prompt, 'Say hello warmly');
  assert.ok(mock.requests.some((q) => q.path === '/api/agents/flow/validate'));
  // The flow check's warnings (objects) reach stderr whole.
  assert.ok(r.errors.some((n) => n.warning?.on === 'flow.json' && n.warning?.message === 'step n9 is unreachable'), r.err);
  // Key order and indentation alone are not a change.
  writeFileSync(flowPath, JSON.stringify(JSON.parse(readFileSync(flowPath, 'utf8')), null, 1));
  r = await sb.run(['prompts', 'diff', FLOW_ID]);
  assert.equal(r.out, 'no changes\n');
});

test('a broken flow is stopped by the flow check', async () => {
  await sb.run(['prompts', 'pull', FLOW_ID, '--force']);
  writeFileSync(join(dirOf(FLOW_ID), 'flow.json'), JSON.stringify({ ...FLOW, nodes: [] }));
  const before = puts().length;
  const r = await sb.run(['prompts', 'push', FLOW_ID]);
  assert.equal(r.code, 1);
  // The flow check answers its errors as plain strings; each must come out whole, as a message.
  assert.deepEqual(r.errors[0].error.errors[0], { on: 'flow.json', message: 'flow has no nodes' });
  assert.equal(puts().length, before);
});

test('files pulled from one server are not pushed to another', async () => {
  await sb.run(['prompts', 'pull', ID, '--force']);
  writeFileSync(join(dirOf(ID), 'prompt.md'), 'Elsewhere\n');
  const r = await sb.run(['prompts', 'push', ID], { env: { TELENOW_BASE_URL: 'https://staging.example' } });
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /pulled from/);
  assert.equal(sb.blocked.length, 0);
});

test('a path-like agent id is refused before anything is read or written', async () => {
  const before = mock.requests.length;
  const r = await sb.run(['prompts', 'pull', '../../etc']);
  assert.equal(r.code, 1);
  assert.equal(mock.requests.length, before);
});
