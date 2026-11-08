/**
 * mock_phase4.mjs — the phase 4a routes of the test stand-in (TELENOW_CLI_PLAN.md §15, step 4a).
 *
 * In here: `phase4Route(rec, state, me, reply, res)` → true when it answered, and `CATALOG` (the
 * catalog it serves unless `state.catalog` replaces it). Shapes follow the route research of
 * 2026-11-08 (voice_ai_rust), including the awkward parts:
 *   GET  /api/catalog                     { success, data:{ llm, stt, tts, telephony, platformFee, features,
 *                                         promptContext } }: no `s2s` key (the server leaves it out when off);
 *                                         LLM models carry `id`, speech models `key` + `configKey`
 *   GET  /api/agents/live-calls           { success, data:{ counts:{ agentId:n }, total } }: idle agents absent
 *   GET  /api/orgs/:o/calls/:id/cost      `data: null` until settled — ALSO for an unknown call id
 *   GET  …/calls/:id/insights             404 "No insights generated for this call yet" (unknown call too)
 *   POST …/calls/:id/insights             developer+ key; 404 unknown call; 400 no transcript; model null
 *   GET  …/calls/:id/trace                owner/admin key only (403 otherwise); 404 unknown call;
 *                                         { success, data:null, reason } when there is no trace
 *   GET  …/calls/columns                  { success, data:{ columns, maxRows, maxRowsWide, channels } }
 *   GET  …/calls/export                   text/csv, CRLF rows, Content-Disposition + x-export-* headers;
 *                                         unknown `fields` id → 400; `state.exportBusy` n → 429 retryAfter 10
 *                                         n times; `state.exportTruncate` → rows/total headers
 *   GET  …/recordings?sessionId=          { success, data:{ recordings, total, nextCursor } } (snake_case rows)
 *   GET  …/recordings/:id/file            the bytes, Content-Type = the row's mime, ALWAYS named .wav;
 *                                         `state.recordingMode`: 'redirect' (302), 'stall' (sends part,
 *                                         never ends), 'short' (Content-Length twice what is sent, then the connection drops),
 *                                         'slow' (`state.slowPieces` pieces, `state.slowGapMs` apart)
 * Every export and recording request is recorded in `state.downloads`.
 * Called by: `mock_server.mjs`.
 */

export const CATALOG = {
  llm: [
    {
      id: 'openai',
      name: 'OpenAI',
      recommended: true,
      models: [
        { id: 'gpt-4o-mini', name: 'GPT-4o mini', recommended: true, pricing: { inputPerM: 0.15, outputPerM: 0.6 } },
        { id: 'gpt-4o', name: 'GPT-4o', recommended: false, pricing: { inputPerM: 2.5, outputPerM: 10 } },
      ],
    },
    { id: 'customapi', name: 'Custom API', models: [{ id: 'custom', name: 'Your model' }] },
  ],
  stt: [
    {
      id: 'deepgram',
      name: 'Deepgram',
      perMinuteUsd: 0.0043,
      models: [
        { key: 'nova-3', name: 'Nova 3', configKey: 'model', recommended: true },
        { key: 'nova-2', name: 'Nova 2', configKey: 'model', recommended: false },
      ],
    },
  ],
  tts: [
    { id: 'cartesia', name: 'Cartesia', voices: [{ id: 'v1', name: 'Static' }], models: [{ key: 'sonic-2', name: 'Sonic 2', configKey: 'model' }] },
    { id: 'polly', name: 'Amazon Polly', models: [{ key: 'neural', name: 'Neural', configKey: 'engine' }] },
  ],
  telephony: [{ id: 'plivo', name: 'Plivo', perMinuteUsd: 0.014 }, { id: 'twilio', name: 'Twilio' }],
  platformFee: { percent: 0, perMinUsd: 0.02, chatTurnBlockTurns: 1, chatTurnBlockUsd: 0, pulseSecs: 0 },
  features: { providerFallback: true, s2s: false, exitGuidance: false, exitGuidanceVoice: false },
  promptContext: { tokens: 120 },
};

export const COLUMNS = [
  { id: 'id', header: 'Call ID', wide: false, default: true, gridDefault: true },
  { id: 'agent', header: 'Agent', wide: false, default: true, gridDefault: true },
  { id: 'started_at', header: 'Started', wide: false, default: true, gridDefault: true },
  { id: 'transcript', header: 'Transcript', wide: true, default: false, gridDefault: false },
];
export const CHANNELS = ['telephony', 'web_call', 'web_chat', 'whatsapp', 'instagram', 'chat', 'softphone', 'simulation'];

const ok = (data) => ({ success: true, data });
const fail = (error, extra = {}) => ({ success: false, error, ...extra });
const writer = (me) => ['owner', 'admin', 'developer'].includes(me.key_role);

export async function phase4Route(rec, state, me, reply, res) {
  const { method, path: p, query: q } = rec;
  state.downloads ??= [];
  let m;

  if (method === 'GET' && p === '/api/catalog') {
    reply(200, ok(state.catalog ?? CATALOG));
    return true;
  }
  if (method === 'GET' && p === '/api/agents/live-calls') {
    const counts = state.live ?? {};
    reply(200, ok({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }));
    return true;
  }

  if (!(m = p.match(/^\/api\/orgs\/([^/]+)(\/.*)$/))) return false;
  // Only the org routes this file serves; every other one is left to the older mocks.
  if (!/^\/(calls\/columns|calls\/export|calls\/[^/]+\/(cost|insights|trace)|recordings(\/[^/]+\/file)?)$/.test(m[2])) return false;
  if (m[1] !== me.org_id) {
    reply(403, fail('This API key is scoped to a different organization.'));
    return true;
  }
  const rest = m[2];
  const call = (id) => state.calls.find((c) => c.id === id);

  if (method === 'GET' && rest === '/calls/columns') {
    reply(200, ok({ columns: COLUMNS, maxRows: 50000, maxRowsWide: 10000, channels: CHANNELS }));
    return true;
  }
  if (method === 'GET' && rest === '/calls/export') {
    state.downloads.push(rec);
    if (state.exportBusy > 0) {
      state.exportBusy--;
      reply(429, fail('another export is already running — try again shortly', { retryAfter: 10 }), { 'Retry-After': '10' });
      return true;
    }
    const ids = q.fields ? q.fields.split(',') : COLUMNS.filter((c) => c.default).map((c) => c.id);
    const unknown = ids.find((f) => !COLUMNS.some((c) => c.id === f));
    if (unknown) {
      reply(400, fail(`unknown field '${unknown}'`));
      return true;
    }
    const cols = ids.map((f) => COLUMNS.find((c) => c.id === f));
    const lines = [cols.map((c) => c.header).join(',')];
    for (const c of state.calls) lines.push(cols.map((col) => (col.id === 'id' ? c.id : col.id === 'agent' ? (c.agent_name ?? '') : (c.start_time ?? ''))).join(','));
    const csv = lines.join('\r\n') + '\r\n';
    const t = state.exportTruncate;
    const name = t ? `calls-2026-11-08-partial-${t.kept}-of-${t.total}.csv` : 'calls-2026-11-08.csv';
    const headers = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'x-export-truncated': t ? 'true' : 'false',
      'x-export-columns': `${cols.length}-of-${COLUMNS.length}`,
      ...(t ? { 'x-export-rows': String(t.kept), 'x-export-total': String(t.total) } : {}),
    };
    reply(200, csv, headers, true);
    return true;
  }
  if ((m = rest.match(/^\/calls\/([^/]+)\/cost$/)) && method === 'GET') {
    reply(200, ok((state.costs ?? {})[m[1]] ?? null));
    return true;
  }
  if ((m = rest.match(/^\/calls\/([^/]+)\/insights$/))) {
    state.insights ??= {};
    if (method === 'GET') {
      const found = state.insights[m[1]];
      reply(found ? 200 : 404, found ? ok(found) : fail('No insights generated for this call yet'));
      return true;
    }
    if (method === 'POST') {
      if (!writer(me)) {
        reply(403, fail(`This API key's role ('${me.key_role}') is read-only on this endpoint.`));
        return true;
      }
      const c = call(m[1]);
      if (!c) {
        reply(404, fail('Call not found'));
        return true;
      }
      if (!Array.isArray(c.transcript) || c.transcript.length === 0) {
        reply(400, fail('This call has no transcript to analyze.'));
        return true;
      }
      const made = { sessionId: c.id, orgId: me.org_id, sentiment: null, sentimentScore: null, summary: null, topics: [], keywords: [], agentWords: 3, customerWords: 4, agentTurns: 1, customerTurns: 1, model: null, createdAt: 't', updatedAt: 't' };
      state.insights[c.id] = made;
      reply(200, ok(made));
      return true;
    }
  }
  if ((m = rest.match(/^\/calls\/([^/]+)\/trace$/)) && method === 'GET') {
    if (!['owner', 'admin'].includes(me.key_role)) {
      reply(403, fail(`this API key's role (${me.key_role}) cannot do this — requires one of: owner, admin`));
      return true;
    }
    const c = call(m[1]);
    if (!c) {
      reply(404, fail('Call not found'));
      return true;
    }
    const t = (state.traces ?? {})[c.id];
    if (!t) {
      reply(200, { success: true, data: null, reason: 'no debug trace for this call (debug mode off for the agent, or not yet flushed)' });
      return true;
    }
    reply(200, ok(t));
    return true;
  }
  if (method === 'GET' && rest === '/recordings') {
    const rows = (state.recordings ?? []).filter((r) => !q.sessionId || r.session_id === q.sessionId);
    reply(200, ok({ recordings: rows, total: rows.length, nextCursor: null }));
    return true;
  }
  if ((m = rest.match(/^\/recordings\/([^/]+)\/file$/)) && method === 'GET') {
    state.downloads.push(rec);
    const r = (state.recordings ?? []).find((x) => x.id === m[1]);
    if (!r) {
      reply(404, fail('recording not found'));
      return true;
    }
    const bytes = state.recordingBytes?.[r.id] ?? Buffer.from(`RIFF-${r.id}`);
    const base = { 'Content-Type': r.mime, 'Content-Disposition': `inline; filename="recording-${r.id}.wav"` };
    if (state.recordingMode === 'redirect') {
      reply(302, '', { Location: 'https://elsewhere.example/recording.wav' }, true);
      return true;
    }
    if (state.recordingMode === 'stall') {
      res.writeHead(200, base);
      res.write(bytes.subarray(0, Math.max(1, bytes.length >> 1)));
      state.stalled = res; // never ended; the test closes it
      return true;
    }
    if (state.recordingMode === 'slow') {
      // Moving, but slowly: a piece every `state.slowGapMs`, so the whole takes longer than the
      // CLI's time limit while no single gap does.
      res.writeHead(200, { ...base, 'Content-Length': String(bytes.length) });
      const pieces = state.slowPieces ?? 6;
      const size = Math.ceil(bytes.length / pieces);
      for (let i = 0; i < bytes.length; i += size) {
        await new Promise((r) => setTimeout(r, state.slowGapMs));
        res.write(bytes.subarray(i, i + size));
      }
      res.end();
      return true;
    }
    if (state.recordingMode === 'short') {
      // Promises twice the bytes, sends them once, then the connection drops.
      res.writeHead(200, { ...base, 'Content-Length': String(bytes.length * 2) });
      res.write(bytes, () => res.destroy());
      return true;
    }
    reply(200, bytes, { ...base, 'Content-Length': String(bytes.length) }, true);
    return true;
  }
  return false;
}
