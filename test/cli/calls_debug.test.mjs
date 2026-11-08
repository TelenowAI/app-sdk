/**
 * calls_debug.test.mjs — phase 4a: a call's cost, insights, trace and recordings; live calls; the
 * CSV export and its columns; the time zone `calls list` and `calls export` send.
 *
 * Covers:
 * - cost: settled / not settled / still going / unknown call (exit 3);
 * - insights: 404 with the hint, `--generate` (developer+), `--dry-run` sends nothing;
 * - trace: the summary without events; `--out` saves it with mode 600 and never over a file
 *   without `--force`; a developer key gets 403 (exit 2); the truncation warning;
 * - live: busiest first, a missing agent reads 0;
 * - export: `--out` required; the CSV saved byte for byte; the zone (TZ, `--tz`) and the filter
 *   names sent; the truncation headers; a busy export waited out; a refused column leaves no file
 *   and no `.part`;
 * - recordings: the list; one saved with its real type; several need `--recording`; a redirect
 *   refused; a stalled or cut-short download leaves nothing behind.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, ORG_ID, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const DEV_KEY = 'vai_live_test_developer_key';
const ADMIN_KEY = 'vai_live_test_admin_key';

let mock;
let sb;
before(async () => {
  mock = await startMock();
  mock.state.keys[DEV_KEY] = { org_id: ORG_ID, org_name: 'Acme', key_id: 'k3', key_name: 'dev', key_role: 'developer', parent_org_id: null };
  mock.state.keys[ADMIN_KEY] = { org_id: ORG_ID, org_name: 'Acme', key_id: 'k4', key_name: 'adm', key_role: 'admin', parent_org_id: null };
  sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
});
after(async () => {
  sb.cleanup();
  await mock.close();
});
beforeEach(() => {
  const s = mock.state;
  s.calls = [
    { id: 'c-ended', agent_name: 'Support', status: 'ended', start_time: '2026-11-07T10:00:00Z', transcript: [{ role: 'user', text: 'hi' }] },
    { id: 'c-live', agent_name: 'Sales', status: 'active', start_time: '2026-11-08T09:00:00Z', transcript: [] },
  ];
  s.costs = {};
  s.insights = {};
  s.traces = {};
  s.live = {};
  s.recordings = [];
  s.recordingBytes = {};
  s.recordingMode = undefined;
  s.exportBusy = 0;
  s.exportTruncate = undefined;
  s.downloads = [];
  mock.requests.length = 0;
});

const leftovers = (dir) => readdirSync(dir).filter((f) => f.endsWith('.part'));

test('calls cost: settled, not settled, still going, and an unknown call', async () => {
  mock.state.costs['c-ended'] = { sessionId: 'c-ended', totalChargeUsd: '0.0420', llmUsd: '0.0100' };
  let r = await sb.run(['calls', 'cost', 'c-ended']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { callId: 'c-ended', settled: true, cost: { sessionId: 'c-ended', totalChargeUsd: '0.0420', llmUsd: '0.0100' } });

  mock.state.costs = {};
  r = await sb.run(['calls', 'cost', 'c-ended']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { callId: 'c-ended', settled: false, cost: null });
  assert.match(r.errors[0].note, /not settled yet/);

  r = await sb.run(['calls', 'cost', 'c-live']);
  assert.match(r.errors[0].note, /still going/);

  // The cost route answers null for a call that does not exist; the CLI finds out and says so.
  r = await sb.run(['calls', 'cost', 'nope']);
  assert.equal(r.code, 3);
  assert.equal(r.errors[0].error.status, 404);
});

test('calls insights: 404 carries the hint; --generate makes them; a viewer key may not; --dry-run sends nothing', async () => {
  let r = await sb.run(['calls', 'insights', 'c-ended']);
  assert.equal(r.code, 3);
  assert.match(r.errors[0].error.hint, /calls insights c-ended --generate/);

  r = await sb.run(['calls', 'insights', 'c-ended', '--generate', '--dry-run']);
  assert.equal(r.code, 0);
  assert.equal(r.json.request.method, 'POST');
  assert.equal(mock.requests.filter((x) => x.method === 'POST').length, 0);

  r = await sb.run(['calls', 'insights', 'c-ended', '--generate']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.sessionId, 'c-ended');
  assert.equal(r.json.model, null);
  r = await sb.run(['calls', 'insights', 'c-ended']);
  assert.equal(r.code, 0);
  assert.equal(r.json.agentWords, 3);

  r = await sb.run(['calls', 'insights', 'c-live', '--generate']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /no transcript/);

  r = await sb.run(['calls', 'insights', 'c-ended', '--generate'], { env: { TELENOW_API_KEY: 'vai_live_test_viewer_key' } });
  assert.equal(r.code, 2);
});

test('calls trace: a summary without the events; --out saves them (mode 600), never over a file without --force', async () => {
  let r = await sb.run(['calls', 'trace', 'c-ended']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.traced, false);
  assert.match(r.json.reason, /debug mode off/);

  const events = Array.from({ length: 50 }, (_, i) => ({ type: 'turn', n: i, context: 'x'.repeat(100) }));
  mock.state.traces['c-ended'] = { call: { id: 'c-ended' }, schema_version: 1, event_count: 50, live_trace: true, post_call_count: 0, truncated: false, max_events: 5000, events };
  r = await sb.run(['calls', 'trace', 'c-ended']);
  assert.equal(r.code, 0);
  assert.equal(r.json.traced, true);
  assert.equal(r.json.eventCount, 50);
  assert.ok(!r.out.includes('"events"'), 'the events are not printed');
  assert.match(r.errors[0].next, /--out/);

  const file = join(sb.home, 'trace.json');
  r = await sb.run(['calls', 'trace', 'c-ended', '--out', 'trace.json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.savedTo, file);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).events.length, 50);
  assert.equal(statSync(file).mode & 0o777, 0o600);

  writeFileSync(file, 'keep me');
  r = await sb.run(['calls', 'trace', 'c-ended', '--out', 'trace.json']);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'file_exists');
  assert.equal(readFileSync(file, 'utf8'), 'keep me');
  r = await sb.run(['calls', 'trace', 'c-ended', '--out', 'trace.json', '--force']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).event_count, 50);
  assert.deepEqual(leftovers(sb.home), []);

  mock.state.traces['c-ended'].truncated = true;
  r = await sb.run(['calls', 'trace', 'c-ended']);
  assert.match(r.errors[0].warning, /end of the call is missing/);

  r = await sb.run(['calls', 'trace', 'c-ended'], { env: { TELENOW_API_KEY: DEV_KEY } });
  assert.equal(r.code, 2);
  r = await sb.run(['calls', 'trace', 'c-ended'], { env: { TELENOW_API_KEY: ADMIN_KEY } });
  assert.equal(r.code, 0);
  r = await sb.run(['calls', 'trace', 'nope']);
  assert.equal(r.code, 3);
});

test('calls live: busiest first; an agent with no live call reads 0', async () => {
  mock.state.live = { a1: 1, a2: 3 };
  let r = await sb.run(['calls', 'live']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { total: 4, agents: [{ agentId: 'a2', live: 3 }, { agentId: 'a1', live: 1 }] });
  r = await sb.run(['calls', 'live', '--agent', 'a9']);
  assert.deepEqual(r.json, { agentId: 'a9', live: 0 });
});

test('calls export: --out is required; the CSV is saved as sent; the zone and the filter names go along', async () => {
  let r = await sb.run(['calls', 'export']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /--out/);
  assert.equal(mock.state.downloads.length, 0);

  r = await sb.run(
    ['calls', 'export', '--out', 'calls.csv', '--from', '2026-11-01', '--to', '2026-11-08', '--agent', 'ag1', '--campaign', 'cp1', '--call-mode', 'agent', '--channel', 'telephony', '--sort', 'oldest', '--columns', 'id,agent'],
    { env: { TZ: 'America/New_York' } },
  );
  assert.equal(r.code, 0, r.err);
  const q = mock.state.downloads[0].query;
  assert.deepEqual(
    { from: q.from, to: q.to, tz: q.tz, agentId: q.agentId, campaignId: q.campaignId, callMode: q.callMode, channel: q.channel, sort: q.sort, fields: q.fields },
    { from: '2026-11-01', to: '2026-11-08', tz: 'America/New_York', agentId: 'ag1', campaignId: 'cp1', callMode: 'agent', channel: 'telephony', sort: 'oldest', fields: 'id,agent' },
  );
  const file = join(sb.home, 'calls.csv');
  assert.equal(readFileSync(file, 'utf8'), 'Call ID,Agent\r\nc-ended,Support\r\nc-live,Sales\r\n');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(r.json, {
    savedTo: file,
    bytes: Buffer.byteLength('Call ID,Agent\r\nc-ended,Support\r\nc-live,Sales\r\n'),
    truncated: false,
    rows: null,
    total: null,
    columns: '2-of-4',
    timeZone: 'America/New_York',
    serverFileName: 'calls-2026-11-08.csv',
  });

  r = await sb.run(['calls', 'export', '--out', 'calls.csv', '--tz', 'Asia/Tokyo', '--force'], { env: { TZ: 'America/New_York' } });
  assert.equal(r.code, 0);
  assert.equal(mock.state.downloads[1].query.tz, 'Asia/Tokyo');

  // With no zone pinned, the computer's own zone is sent — never nothing.
  r = await sb.run(['calls', 'export', '--out', 'calls.csv', '--force']);
  assert.equal(mock.state.downloads[2].query.tz, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('calls export: truncation is reported; a busy export is waited out; a refused column leaves nothing behind', async () => {
  mock.state.exportTruncate = { kept: 2, total: 9 };
  let r = await sb.run(['calls', 'export', '--out', 'part.csv']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.truncated, true);
  assert.equal(r.json.rows, 2);
  assert.equal(r.json.total, 9);
  assert.match(r.errors[0].warning, /stopped at 2 of 9/);
  mock.state.exportTruncate = undefined;

  mock.state.exportBusy = 1;
  const before = sb.sleeps.length;
  r = await sb.run(['calls', 'export', '--out', 'busy.csv']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sb.sleeps.slice(before), [10_000]);

  r = await sb.run(['calls', 'export', '--out', 'bad.csv', '--columns', 'id,nope']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /unknown field 'nope'/);
  assert.equal(existsSync(join(sb.home, 'bad.csv')), false);
  assert.deepEqual(leftovers(sb.home), []);

  r = await sb.run(['calls', 'export', '--out', 'x.csv', '--sort', 'random']);
  assert.equal(r.code, 1);
});

test('calls export-columns: the server\'s list, limits and channels in a note', async () => {
  const r = await sb.run(['calls', 'export-columns']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.map((c) => c.id), ['id', 'agent', 'started_at', 'transcript']);
  assert.deepEqual(r.errors[0].limits, { maxRows: 50000, maxRowsWide: 10000 });
  assert.ok(r.errors[0].channels.includes('telephony'));
});

test('calls list sends the zone its --from / --to days are in', async () => {
  const r = await sb.run(['calls', 'list', '--from', '2026-11-01'], { env: { TZ: 'Europe/London' } });
  assert.equal(r.code, 0, r.err);
  const q = mock.requests.find((x) => x.path === `/api/orgs/${ORG_ID}/calls`).query;
  assert.equal(q.tz, 'Europe/London');
});

const rec = (id, session, mime, extra = {}) => ({
  id,
  org_id: ORG_ID,
  session_id: session,
  agent_id: null,
  channel: 'mixed',
  storage_kind: 'local_fs',
  storage_path: `x/${id}`,
  mime,
  sample_rate: 16000,
  duration_sec: 42,
  size_bytes: 8,
  metadata: null,
  created_at: '2026-11-07T10:01:00Z',
  deleted_at: null,
  ...extra,
});

test('calls recording: lists; saves the only one with its real type; several need --recording', async () => {
  let r = await sb.run(['calls', 'recording', 'c-ended']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, []);
  assert.match(r.errors[0].note, /no recording/);
  r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'a.wav']);
  assert.equal(r.code, 3);

  mock.state.recordings = [rec('r1', 'c-ended', 'audio/mpeg')];
  mock.state.recordingBytes.r1 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);
  r = await sb.run(['calls', 'recording', 'c-ended']);
  assert.deepEqual(r.json, [{ id: 'r1', channel: 'mixed', mime: 'audio/mpeg', durationSec: 42, sizeBytes: 8, createdAt: '2026-11-07T10:01:00Z', source: null }]);
  assert.equal(mock.requests.at(-1).query.sessionId, 'c-ended');

  r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'call.mp3']);
  assert.equal(r.code, 0, r.err);
  const file = join(sb.home, 'call.mp3');
  assert.deepEqual(readFileSync(file), mock.state.recordingBytes.r1);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(r.json.mime, 'audio/mpeg');
  assert.equal(r.json.bytes, 8);
  assert.equal(r.errors[0].downloading.id, 'r1');
  assert.equal(mock.state.downloads.at(-1).headers['x-api-key'], GOOD_KEY);

  mock.state.recordings.push(rec('r2', 'c-ended', 'audio/wav', { metadata: { source: 'transfer_bridge' } }));
  r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'two.wav']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /2 recordings/);
  assert.equal(r.errors[0].error.recordings[1].source, 'transfer_bridge');
  assert.equal(existsSync(join(sb.home, 'two.wav')), false);
  r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'two.wav', '--recording', 'r2']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.recordingId, 'r2');
  r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'three.wav', '--recording', 'r9']);
  assert.equal(r.code, 3);
});

// The time limit is a guard: a stall that is not detected fails this test instead of hanging the suite.
test('calls recording: a redirect is refused; a stalled or cut-short download leaves no file and no .part', { timeout: 20_000 }, async () => {
  mock.state.recordings = [rec('r1', 'c-ended', 'audio/wav')];
  mock.state.recordingBytes.r1 = Buffer.alloc(4096, 7);

  mock.state.recordingMode = 'redirect';
  let r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'redir.wav']);
  assert.equal(r.code, 1);
  assert.match(r.errors.at(-1).error.message, /redirect/);
  assert.equal(existsSync(join(sb.home, 'redir.wav')), false);

  mock.state.recordingMode = 'stall';
  r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'stall.wav'], { env: { TELENOW_TIMEOUT_MS: '300' } });
  mock.state.stalled?.destroy();
  assert.equal(r.code, 7);
  assert.match(r.errors.at(-1).error.message, /stalled/);
  assert.equal(existsSync(join(sb.home, 'stall.wav')), false);

  mock.state.recordingMode = 'short';
  r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'short.wav']);
  assert.equal(r.code, 7);
  assert.equal(existsSync(join(sb.home, 'short.wav')), false);
  assert.deepEqual(leftovers(sb.home), []);
});

test('calls recording: a slow download that keeps moving is not cut off by the time limit', { timeout: 20_000 }, async () => {
  mock.state.recordings = [rec('r1', 'c-ended', 'audio/wav')];
  mock.state.recordingBytes.r1 = Buffer.alloc(6000, 3);
  mock.state.recordingMode = 'slow';
  mock.state.slowPieces = 6;
  mock.state.slowGapMs = 150; // 6 × 150 ms = 900 ms in all, against a 400 ms limit per wait
  const r = await sb.run(['calls', 'recording', 'c-ended', '--out', 'slow.wav'], { env: { TELENOW_TIMEOUT_MS: '400' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(sb.home, 'slow.wav')).length, 6000);
});
