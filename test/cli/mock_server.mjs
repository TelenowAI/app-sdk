/**
 * mock_server.mjs — a local stand-in for the Telenow API routes the account commands call.
 *
 * In here: `startMock()` → { url, state, requests, close }. It answers like the real routes
 * (checked in voice_ai_rust on 2026-11-08):
 *   GET  /api/v1/me                         raw object (no envelope); 401 for an unknown key
 *   GET  /api/agents                        { success, data: { agents, total, limit, offset } }
 *   GET  /api/agents/:id                    { success, data: agent }
 *   GET  /api/agents/:id/versions           { success, data: { versions: [{ version }] } }, newest first
 *   PUT  /api/agents/:id                    camelCase body; `If-Match: "N"` / `expectedVersion`;
 *                                           409 { success:false, error, code:'agent_version_conflict',
 *                                           currentVersion }; `metadata` REPLACES the stored one;
 *                                           answers { success, data, version }
 *   POST /api/agents/prompt/validate        { success, data: { valid, errors, warnings } }, errors and warnings
 *                                           as objects ({ field, code, line, column, message })
 *   POST /api/agents/flow/validate          same envelope, but `errors` are plain STRINGS (`Vec<String>` from
 *                                           FlowGraph::validate) and `warnings` objects ({ code, at, message }) —
 *                                           found by the real-server e2e on 11-08 (tn_e1)
 *   GET  /api/orgs/:org/calls[/:id]         403 when :org is not the key's org (the pivot guard)
 *   GET  /api/voice/numbers                 { success, data: { numbers, total } }
 *   the phase 4a routes (catalog, live calls, call cost / insights / trace, export, recordings) in
 *                                           `mock_phase4.mjs`, answered before the agent and call routes
 *   /api/v1/chat …                          the Chat API (`mock_chat.mjs`)
 *   /api/voice/numbers/…                    one number, search, buy, release, assign, … (`mock_numbers.mjs`)
 *   /api/v1/sub-accounts …                  sub-accounts and their keys (`mock_sub_accounts.mjs`)
 *   POST /api/cli-login/start | /token, POST /api/v1/me/revoke   the browser login (`mock_cli_login.mjs`),
 *                                           answered before the key check: start and token take no key
 * A key marked `expired: true` in `state.keys` gets 401 everywhere, as an expired key does.
 * Every request is recorded in `requests` (method, path, query, headers, body) for the tests.
 * `state.hooks.beforePut(id)` lets a test change the agent between a push's check and its save.
 * `state.respond(req)` lets a test answer a request itself (return a response object or undefined).
 * Not in here: the tests.
 * Called by: the *.test.mjs files in this folder.
 */

import { createServer } from 'node:http';

import { cliLoginRoute, makeCliLoginState } from './mock_cli_login.mjs';
import { chatRoute } from './mock_chat.mjs';
import { numbersRoute } from './mock_numbers.mjs';
import { subAccountsRoute } from './mock_sub_accounts.mjs';
import { phase2Route } from './mock_phase2.mjs';
import { phase4Route } from './mock_phase4.mjs';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
export const GOOD_KEY = 'vai_live_test_owner_key';
export const VIEWER_KEY = 'vai_live_test_viewer_key';

export function makeState() {
  return {
    keys: {
      [GOOD_KEY]: { org_id: ORG_ID, org_name: 'Acme', key_id: 'k1', key_name: 'ci', key_role: 'owner', parent_org_id: null },
      [VIEWER_KEY]: { org_id: ORG_ID, org_name: 'Acme', key_id: 'k2', key_name: 'ro', key_role: 'viewer', parent_org_id: null },
    },
    agents: {},
    versions: {},
    calls: [],
    numbers: [],
    hooks: {},
    respond: undefined,
    cliLogin: makeCliLoginState(),
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const ok = (data) => ({ success: true, data });
const fail = (error, extra = {}) => ({ success: false, error, ...extra });

export async function startMock(state = makeState()) {
  const requests = [];
  let selfUrl;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const u = new URL(req.url, 'http://mock');
    const record = { method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body, bytes: raw.length };
    requests.push(record);

    // The server's idempotency layer (middleware/idempotency.rs) buffers a keyed POST's body and
    // refuses one over 5 MiB with a plain-text 413 — before any route sees it.
    if (req.method === 'POST' && req.headers['idempotency-key'] && Buffer.byteLength(raw) > 5 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      return res.end('body too large');
    }

    if (state.respond) {
      const r = await state.respond(record);
      if (r) return send(res, r.status, r.body, r.headers);
    }

    const reply = (status, b, h = {}, raw = false) => {
      if (!raw) return send(res, status, b, h);
      res.writeHead(status, h);
      res.end(b ?? '');
    };
    if (cliLoginRoute(record, state, reply, { frontendUrl: selfUrl, orgId: ORG_ID })) return;

    const key = req.headers['x-api-key'];
    const me = state.keys[key];
    if (!me) return send(res, 401, fail('Invalid API key', { code: 'invalid_api_key' }));
    if (me.expired) return send(res, 401, fail('This API key has expired', { code: 'api_key_expired' }));
    const p = u.pathname;
    let m;

    if (req.method === 'GET' && p === '/api/v1/me') return send(res, 200, me);
    // Before the agent and call routes: `/api/agents/live-calls` and `/calls/export` would
    // otherwise be read as an agent id and a call id.
    if (await phase4Route(record, state, me, reply, res)) return;
    if (await chatRoute(record, state, me, reply)) return;
    if (await numbersRoute(record, state, me, reply)) return;
    if (await subAccountsRoute(record, state, me, reply)) return;

    if (req.method === 'GET' && p === '/api/agents') {
      const all = Object.values(state.agents);
      const limit = Math.min(Number(u.searchParams.get('limit') ?? 50), 200);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      return send(res, 200, ok({ agents: all.slice(offset, offset + limit), total: all.length, limit, offset }));
    }
    if (req.method === 'POST' && p === '/api/agents') {
      if (!['owner', 'admin', 'developer'].includes(me.key_role)) return send(res, 403, fail("This API key's role can't modify agents"));
      const idem = req.headers['idempotency-key'];
      state.idempotent ??= {};
      if (idem && state.idempotent[idem]) return send(res, state.idempotent[idem].status, state.idempotent[idem].body);
      const id = `c${String(Object.keys(state.agents).length).padStart(7, '0')}-0000-4000-8000-000000000000`;
      const a = agentRow(id, { name: body?.name, system_prompt: body?.systemPrompt ?? null, metadata: body?.metadata ?? {} });
      state.agents[id] = a;
      state.versions[id] = 0;
      const out = { status: 201, body: ok(a) };
      if (idem) state.idempotent[idem] = out;
      return send(res, out.status, out.body);
    }
    if ((m = p.match(/^\/api\/agents\/([^/]+)\/versions$/)) && req.method === 'GET') {
      const a = state.agents[m[1]];
      if (!a) return send(res, 404, fail('Agent not found or access denied'));
      const cur = state.versions[m[1]] ?? 0;
      const versions = [];
      for (let v = cur; v >= 1; v--) versions.push({ version: v, note: null, createdAt: '2026-11-08T00:00:00Z' });
      return send(res, 200, ok({ versions }));
    }
    if (req.method === 'POST' && p === '/api/agents/prompt/validate') {
      const prompt = String(body?.prompt ?? '');
      const opens = (prompt.match(/\{#if/g) ?? []).length;
      const closes = (prompt.match(/\{\/if\}/g) ?? []).length;
      const errors = opens === closes ? [] : [{ field: 'prompt', code: 'unclosed_section', line: 1, column: 1, message: '`{#if` is never closed' }];
      const warnings = prompt.includes('{unknown_var}') ? [{ field: 'prompt', code: 'unknown_variable', message: 'unknown variable' }] : [];
      return send(res, 200, ok({ valid: errors.length === 0, errors, warnings }));
    }
    if (req.method === 'POST' && p === '/api/agents/flow/validate') {
      const nodes = body?.flow?.nodes;
      const errors = Array.isArray(nodes) && nodes.length > 0 ? [] : ['flow has no nodes'];
      const warnings = Array.isArray(nodes) && nodes.length > 0 ? [{ code: 'unreachable', at: 'n9', message: 'step n9 is unreachable' }] : [];
      return send(res, 200, ok({ valid: errors.length === 0, errors, warnings, multiContext: false }));
    }
    if ((m = p.match(/^\/api\/agents\/([^/]+)$/))) {
      const id = m[1];
      const a = state.agents[id];
      if (!a) return send(res, 404, fail('Agent not found or access denied'));
      if (req.method === 'GET') return send(res, 200, ok(a));
      if (req.method === 'DELETE') {
        if (!['owner', 'admin', 'developer'].includes(me.key_role)) return send(res, 403, fail("This API key's role can't modify agents"));
        delete state.agents[id];
        return send(res, 200, { success: true, message: 'Agent deleted' });
      }
      if (req.method === 'PUT') {
        if (!['owner', 'admin', 'developer'].includes(me.key_role)) {
          return send(res, 403, fail("This API key's role can't modify agents"));
        }
        if (state.hooks.beforePut) await state.hooks.beforePut(id);
        const ifMatch = req.headers['if-match'];
        const expected = ifMatch !== undefined ? Number(String(ifMatch).replace(/^W\//, '').replace(/"/g, '')) : body?.expectedVersion;
        const cur = state.versions[id] ?? 0;
        if (expected !== undefined && expected !== cur) {
          return send(res, 409, fail(`This agent was changed since you loaded it (now version ${cur}).`, { code: 'agent_version_conflict', currentVersion: cur }));
        }
        if (typeof body?.systemPrompt === 'string') a.system_prompt = body.systemPrompt;
        if (typeof body?.name === 'string') a.name = body.name;
        if (body?.metadata !== undefined) a.metadata = body.metadata; // replaced whole, as the real save does
        a.updated_at = new Date().toISOString();
        state.versions[id] = cur + 1;
        return send(res, 200, { success: true, data: a, version: cur + 1 });
      }
    }
    if ((m = p.match(/^\/api\/orgs\/([^/]+)\/calls(?:\/([^/]+))?$/)) && req.method === 'GET') {
      if (m[1] !== me.org_id) return send(res, 403, fail('This API key belongs to another organization'));
      if (m[2]) {
        const c = state.calls.find((x) => x.id === m[2]);
        return c ? send(res, 200, ok(c)) : send(res, 404, fail('Call not found'));
      }
      const limit = Math.min(Number(u.searchParams.get('limit') ?? 50), 200);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      return send(res, 200, ok({ calls: state.calls.slice(offset, offset + limit), total: state.calls.length }));
    }
    if (req.method === 'GET' && p === '/api/voice/numbers') {
      return send(res, 200, ok({ numbers: state.numbers, total: state.numbers.length }));
    }
    if (await phase2Route(record, state, me, (status, b, h) => send(res, status, b, h))) return;
    return send(res, 404, fail(`no route ${req.method} ${p}`));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  selfUrl = `http://127.0.0.1:${port}`;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    requests,
    // Drops open connections first (a download a test left hanging), so closing never waits on one.
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(r);
      }),
  };
}

export function agentRow(id, overrides = {}) {
  return {
    id,
    org_id: ORG_ID,
    name: `Agent ${id.slice(0, 4)}`,
    description: null,
    system_prompt: 'You are a helpful agent.',
    is_active: true,
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
    llm_config: { apiKey: '••••••••' },
    tts_provider: 'cartesia',
    tts_voice: 'v1',
    metadata: { variables: [{ name: 'plan' }], tools: [{ name: 'lookup_order', config: { token: '••••' } }] },
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}
