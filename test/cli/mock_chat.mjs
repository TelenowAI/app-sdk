/**
 * mock_chat.mjs — the Chat API of the test stand-in (TELENOW_CLI_PLAN.md §15, step 4b).
 *
 * In here: `chatRoute(rec, state, me, reply)` → true when it answered. Shapes follow voice_ai_rust main
 * (bfd2df4, `routes/public_api.rs`), flat JSON (no `{ success, data }`), including the awkward parts:
 *   POST /api/v1/chat                  body `agentId` (or `agent_id`), `identifier`, `input`, `sessionId?`, `variables?`,
 *                                      `optionId?` → 200 `{ sessionId, reply, turn, identifier, ui? }`;
 *                                      400 bad identifier / no input; 404 unknown agent or session; 403 identifier
 *                                      mismatch; 410 `{ error, code: "SESSION_EXPIRED" }` (NO `success`) for an
 *                                      ended session or `state.chatExpire`; 409 `{ error: "turn in progress" }`
 *                                      (NO `success`) while `state.chatBusy`; a keyed retry replays the first answer
 *   GET  /api/v1/chat/:id/messages     `{ sessionId, messages: [{ role, content, createdAt, ui? }] }`; 404 otherwise
 *   POST /api/v1/chat/:id/end          `{ sessionId, ended: true }`, also when already ended; 404 "Chat session not
 *                                      found" for an id in `state.voiceSessions` (a phone call)
 * The agent's reply: `state.chatReply(input, session)` when set, else "echo: <input>". An input of "menu" gets
 * options `ui`; "link" a link `ui`. `state.chatDelayMs` delays every answer; `state.onChatTurn(body)` runs first.
 * Every session is in `state.chats[id]` = { agentId, identifier, variables, ended, turns, messages, options }.
 * Called by: `mock_server.mjs`.
 */

let seq = 0;
const newId = () => `5e55${String(++seq).padStart(4, '0')}-0000-4000-8000-000000000000`;
const fail = (error, extra = {}) => ({ success: false, error, ...extra });

export const MENU = {
  kind: 'options',
  shownAs: 'buttons',
  options: [
    { id: 'plan_basic', title: 'Basic' },
    { id: 'plan_pro', title: 'Pro', description: 'everything' },
  ],
};

export async function chatRoute(rec, state, me, reply) {
  const { method, path: p, body, headers } = rec;
  let m;
  state.chats ??= {};
  if (method === 'POST' && p === '/api/v1/chat') {
    state.chatIdem ??= {};
    const key = headers['idempotency-key'];
    if (key && state.chatIdem[key]) {
      const r = state.chatIdem[key];
      reply(r.status, r.body, { 'Idempotent-Replay': 'true' });
      return true;
    }
    if (state.onChatTurn) await state.onChatTurn(body);
    if (state.chatDelayMs) await new Promise((r) => setTimeout(r, state.chatDelayMs));
    const r = turn(state, me, body ?? {});
    if (key && r.status < 300) state.chatIdem[key] = r;
    reply(r.status, r.body);
    return true;
  }
  if ((m = p.match(/^\/api\/v1\/chat\/([^/]+)\/messages$/)) && method === 'GET') {
    const s = state.chats[m[1]];
    if (!s || s.orgId !== me.org_id) reply(404, fail('Session not found'));
    else reply(200, { sessionId: m[1], messages: s.messages });
    return true;
  }
  if ((m = p.match(/^\/api\/v1\/chat\/([^/]+)\/end$/)) && method === 'POST') {
    if ((state.voiceSessions ?? []).includes(m[1])) {
      reply(404, fail('Chat session not found'));
      return true;
    }
    const s = state.chats[m[1]];
    if (!s || s.orgId !== me.org_id) {
      reply(404, fail('Session not found'));
      return true;
    }
    s.ended = true;
    s.endCalls = (s.endCalls ?? 0) + 1;
    reply(200, { sessionId: m[1], ended: true });
    return true;
  }
  return false;
}

function turn(state, me, body) {
  const agentId = body.agentId ?? body.agent_id;
  const identifier = String(body.identifier ?? '').trim();
  const input = String(body.input ?? '').trim();
  if (identifier.length === 0 || [...identifier].length > 128) return { status: 400, body: fail('identifier must be 1–128 characters') };
  if (input === '') return { status: 400, body: fail('input is required') };
  const agent = state.agents[agentId];
  if (!agent || agent.org_id !== me.org_id) return { status: 404, body: fail('Agent not found') };
  let id = body.sessionId ?? body.session_id;
  let s;
  if (id) {
    s = state.chats[id];
    if (!s || s.orgId !== me.org_id || s.agentId !== agentId) return { status: 404, body: fail('Session not found') };
    if (s.identifier !== identifier) return { status: 403, body: fail('identifier does not match this session') };
    if (s.ended || state.chatExpire) {
      state.chatExpire = false;
      s.ended = true;
      return { status: 410, body: { error: 'session expired', code: 'SESSION_EXPIRED' } };
    }
    if (state.chatBusy) return { status: 409, body: { error: 'turn in progress' } };
  } else {
    id = newId();
    s = { orgId: me.org_id, agentId, identifier, variables: body.variables ?? null, ended: false, turns: 0, messages: [] };
    state.chats[id] = s;
  }
  s.turns++;
  s.lastOptionId = body.optionId ?? body.option_id ?? null;
  const text = state.chatReply ? state.chatReply(input, s) : `echo: ${input}`;
  const ui = input === 'menu' ? MENU : input === 'link' ? { kind: 'link', shownAs: 'link_button', label: 'Pay', url: 'https://pay.example/x' } : undefined;
  s.messages.push({ role: 'user', content: input, createdAt: '2026-11-08T10:00:00Z' });
  s.messages.push({ role: 'assistant', content: text, createdAt: '2026-11-08T10:00:01Z', ...(ui ? { ui } : {}) });
  return { status: 200, body: { sessionId: id, reply: text, turn: s.turns, identifier, ...(ui ? { ui } : {}) } };
}
