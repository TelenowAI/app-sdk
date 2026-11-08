/**
 * models.test.mjs — phase 4a: `telenow models list`, and the catalog check before an agent save.
 *
 * Covers:
 * - models list: one row per model (or per provider without models); the kinds come from the
 *   server's answer (a new kind shows up, a missing one is refused with the real list);
 *   `--provider`; `--full` adds each entry;
 * - agents create: a misspelt model stops the save with the closest ids and nothing is sent;
 *   `--skip-catalog-check` sends it; a body without model fields does not read the catalog;
 * - agents update: changing only the model checks it against the agent's SAVED provider;
 *   changing only the provider checks the saved model against the new one; a config's model
 *   setting (`ttsConfig.engine` for Polly) is checked by its own `configKey`.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { CATALOG } from './mock_phase4.mjs';
import { GOOD_KEY, agentRow, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const AGENT = 'a0000000-0000-4000-8000-000000000001';
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
  mock.state.catalog = undefined;
  mock.state.agents = { [AGENT]: agentRow(AGENT, { tts_provider: 'cartesia' }) };
  mock.state.versions = { [AGENT]: 1 };
  mock.requests.length = 0;
});

function file(name, obj) {
  const p = join(sb.home, name);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
const sent = (method, path) => mock.requests.filter((r) => r.method === method && r.path === path);

test('models list: one row per model; kinds from the answer; --provider; --full', async () => {
  let r = await sb.run(['models', 'list']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json[0], { kind: 'llm', provider: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o mini', recommended: true });
  assert.ok(r.json.some((x) => x.kind === 'stt' && x.model === 'nova-3'));
  assert.ok(r.json.some((x) => x.kind === 'telephony' && x.provider === 'plivo' && x.model === null));
  assert.ok(!r.json.some((x) => ['platformFee', 'features', 'promptContext'].includes(x.kind)));

  r = await sb.run(['models', 'list', '--kind', 'tts', '--provider', 'polly']);
  assert.deepEqual(r.json, [{ kind: 'tts', provider: 'polly', model: 'neural', name: 'Neural', recommended: null }]);

  r = await sb.run(['models', 'list', '--kind', 's2s']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /one of llm, stt, tts, telephony \(got 's2s'\)/);

  mock.state.catalog = { ...CATALOG, s2s: [{ id: 'openai-rt', name: 'Realtime', models: [{ modelKey: 'rt-1', name: 'RT 1' }] }] };
  r = await sb.run(['models', 'list', '--kind', 's2s']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, [{ kind: 's2s', provider: 'openai-rt', model: 'rt-1', name: 'RT 1', recommended: null }]);

  r = await sb.run(['models', 'list', '--kind', 'llm', '--full']);
  assert.equal(r.json[0].details.pricing.inputPerM, 0.15);
  assert.equal(r.json[0].providerName, 'OpenAI');
  r = await sb.run(['models', 'list', '--provider', 'nobody']);
  assert.deepEqual(r.json, []);
  assert.match(r.errors[0].note, /no provider 'nobody'/);
});

test('agents create: a misspelt model stops the save and names the closest ids; --skip-catalog-check sends it', async () => {
  const body = { name: 'X', llmProvider: 'openai', llmModel: 'gpt-4o-mni', sttProvider: 'deepgram', ttsProvider: 'cartesia', ttsVoice: 'v1', sessionConfig: {} };
  let r = await sb.run(['agents', 'create', '--file', file('bad.json', body)]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'not_in_catalog');
  assert.equal(r.errors[0].error.field, 'llmModel');
  assert.equal(r.errors[0].error.closest[0], 'gpt-4o-mini');
  assert.equal(sent('POST', '/api/agents').length, 0);

  r = await sb.run(['agents', 'create', '--file', file('bad2.json', { ...body, llmModel: 'gpt-4o-mini', ttsProvider: 'cartesai' })]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.field, 'ttsProvider');
  assert.equal(r.errors[0].error.closest[0], 'cartesia');

  r = await sb.run(['agents', 'create', '--file', file('bad3.json', { ...body, llmModel: 'gpt-4o-mini', sttConfig: { model: 'nova-9' } })]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.field, 'sttConfig.model');

  r = await sb.run(['agents', 'create', '--file', file('bad.json', body), '--skip-catalog-check']);
  assert.equal(r.code, 0, r.err);
  assert.equal(sent('POST', '/api/agents').length, 1);
  assert.equal(sent('GET', '/api/catalog').length, 3);

  r = await sb.run(['agents', 'create', '--file', file('good.json', { ...body, llmModel: 'gpt-4o', sttConfig: { model: 'nova-2' } })]);
  assert.equal(r.code, 0, r.err);
  assert.equal(sent('POST', '/api/agents').length, 2);

  mock.requests.length = 0;
  r = await sb.run(['agents', 'create', '--file', file('plain.json', { name: 'Y' })]);
  assert.equal(r.code, 0, r.err);
  assert.equal(sent('GET', '/api/catalog').length, 0, 'no model field, no catalog read');
});

test('agents update: one half of a pair is checked against the agent as saved', async () => {
  // Only the model: checked against the saved provider (openai).
  let r = await sb.run(['agents', 'update', AGENT, '--file', file('m.json', { llmModel: 'custom' })]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /llm provider 'openai'/);
  assert.equal(sent('PUT', `/api/agents/${AGENT}`).length, 0);

  // Only the provider: the saved model (gpt-4o-mini) is not one of customapi's.
  r = await sb.run(['agents', 'update', AGENT, '--file', file('p.json', { llmProvider: 'customapi' })]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.value, 'gpt-4o-mini');

  r = await sb.run(['agents', 'update', AGENT, '--file', file('pm.json', { llmProvider: 'customapi', llmModel: 'custom' })]);
  assert.equal(r.code, 0, r.err);
  assert.equal(sent('PUT', `/api/agents/${AGENT}`).length, 1);

  // Polly's model setting is `engine`, not `model`.
  r = await sb.run(['agents', 'update', AGENT, '--file', file('t.json', { ttsProvider: 'polly', ttsConfig: { engine: 'standard' } })]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.field, 'ttsConfig.engine');
  r = await sb.run(['agents', 'update', AGENT, '--file', file('t2.json', { ttsProvider: 'polly', ttsConfig: { engine: 'neural' } })]);
  assert.equal(r.code, 0, r.err);

  mock.requests.length = 0;
  r = await sb.run(['agents', 'update', AGENT, '--file', file('n.json', { name: 'Renamed' })]);
  assert.equal(r.code, 0, r.err);
  assert.equal(sent('GET', '/api/catalog').length, 0);
});
