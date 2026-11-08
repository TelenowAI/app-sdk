/**
 * mock_numbers.mjs — the phone-number routes of the test stand-in (TELENOW_CLI_PLAN.md §15, step 4c).
 *
 * In here: `numbersRoute(rec, state, me, reply)` → true when it answered. Shapes follow voice_ai_rust main (bfd2df4,
 * `features/numbers/routes.rs` + `service.rs`), `{ success, data }`:
 *   GET    /api/voice/numbers/:id                 the row with price_currency / monthly_rent_usd / setup_price_usd;
 *                                                 404 "Phone number not found" (released too)
 *   GET    /search?country&provider&pattern&match&type&region&limit&offset
 *                                                 { provider, numbers: [priced], meta }; no `country` → 400 plain text;
 *                                                 provider "closed" → 403
 *   POST   /purchase                              201 { number, integrationExternalId, providerStatus, complianceLinked }
 *                                                 (NO charge in it); 409 already owned; `state.spendBlocked` → 403
 *   DELETE /:id                                   { success, message: "Number released" }; `state.whatsappNumbers` → 409
 *   POST   /:id/assign-agent { agentId }          moves it AND clears is_default_outbound + inbound_action
 *   DELETE /:id/agent                             clears the agent and is_default_outbound; a pool number → 400
 *   POST   /:id/default-outbound { isDefault }    a missing field reads as false; no agent → 400
 *   POST   /:id/inbound-action { action }         null clears; an agent bound → 409; an unknown action → 400
 *   GET    /providers | /renewal-risk | /reclaimable | /compliance/requirements
 *   POST   /:id/reclaim                           { status: "restored", number, restore, chargedUsd }; not reclaimable → 400
 * Writes need an owner, admin or developer key (403 read-only otherwise). A keyed purchase or reclaim retried with the
 * same Idempotency-Key replays the first answer. Rows live in `state.numbers`; for sale in `state.inventory`; lost and
 * reclaimable in `state.reclaimable`. Every purchase body is kept in `state.purchases`.
 * Called by: `mock_server.mjs`.
 */

const ok = (data) => ({ success: true, data });
const fail = (error, extra = {}) => ({ success: false, error, ...extra });
const writer = (me) => ['owner', 'admin', 'developer'].includes(me.key_role);
const ACTIONS = ['speak', 'forward', 'reject', 'no-answer'];
const RATES = { INR: 0.012, EUR: 1.08, USD: 1 };
const currencyOf = (provider) => (provider === 'exotel' ? 'INR' : provider === 'vonage' ? 'EUR' : 'USD');
const usd = (amount, cur) => (amount == null ? null : (Number(amount) * RATES[cur]).toFixed(4));
const priced = (row) => {
  const cur = currencyOf(row.provider);
  return { ...row, price_currency: cur, monthly_rent_usd: usd(row.monthly_rent, cur), setup_price_usd: usd(row.setup_price, cur) };
};

let seq = 0;
const newId = () => `0b0b${String(++seq).padStart(4, '0')}-0000-4000-8000-000000000000`;

export function numberRow(id, e164, overrides = {}) {
  return {
    id,
    e164,
    provider: 'plivo',
    source: 'purchased',
    number_type: 'local',
    agent_id: null,
    is_default_outbound: false,
    inbound_action: null,
    is_pool: false,
    monthly_rent: '1.15',
    setup_price: '0',
    released_at: null,
    ...overrides,
  };
}

export async function numbersRoute(rec, state, me, reply) {
  const { method, path: p, query: q, body, headers } = rec;
  if (!p.startsWith('/api/voice/numbers/')) return false;
  const rest = p.slice('/api/voice/numbers'.length);
  state.numbers ??= [];
  state.purchases ??= [];
  state.numIdem ??= {};
  const send = (status, b) => {
    reply(status, b);
    return true;
  };
  const replay = (scope, compute) => {
    const k = headers['idempotency-key'];
    const slot = k ? `${scope}|${k}` : null;
    if (slot && state.numIdem[slot]) {
      const r = state.numIdem[slot];
      reply(r.status, r.body, { 'Idempotent-Replay': 'true' });
      return true;
    }
    const r = compute();
    if (slot && r.status < 300) state.numIdem[slot] = r;
    return send(r.status, r.body);
  };
  if (method !== 'GET' && !writer(me)) return send(403, fail(`This API key's role ('${me.key_role}') is read-only on this endpoint.`));
  const live = (id) => state.numbers.find((n) => n.id === id && !n.released_at);
  let m;

  if (method === 'GET' && rest === '/providers') {
    return send(200, ok({ default: 'plivo', providers: [{ id: 'plivo', isDefault: true, capabilities: { supports_compliance: true } }, { id: 'exotel', isDefault: false, capabilities: {} }] }));
  }
  if (method === 'GET' && rest === '/search') {
    if (!q.country) {
      reply(400, 'Failed to deserialize query string: missing field `country`', { 'Content-Type': 'text/plain' }, true);
      return true;
    }
    const provider = q.provider ?? 'plivo';
    if (provider === 'closed') return send(403, fail('Numbers on closed are not available to this organization yet.'));
    const digits = (s) => s.replace(/\D/g, '');
    const all = (state.inventory ?? []).filter((n) => (n.provider ?? 'plivo') === provider && (!q.pattern || digits(n.e164).includes(q.pattern)));
    const numbers = all.map((n) => priced({ ...n, provider })).map(({ provider: _p, ...n }) => ({ ...n, raw: { carrier: 'detail' } }));
    return send(200, ok({ provider, numbers, meta: null }));
  }
  if (method === 'POST' && rest === '/purchase') {
    return replay('purchase', () => {
      if (state.spendBlocked) return { status: 403, body: fail('Out of credits — buy credits on the Billing page to continue.') };
      state.purchases.push(body);
      if (state.numbers.some((n) => n.e164 === body.number && !n.released_at)) return { status: 409, body: fail('Number is already in your inventory') };
      const forSale = (state.inventory ?? []).find((n) => n.e164 === body.number);
      if (!forSale) return { status: 400, body: fail('carrier refused: number not available') };
      const row = numberRow(newId(), body.number, { provider: body.provider ?? 'plivo', monthly_rent: forSale.monthly_rent ?? body.extras?.monthlyRent ?? null, setup_price: forSale.setup_price ?? null });
      state.numbers.push(row);
      return { status: 201, body: ok({ number: row, integrationExternalId: null, providerStatus: 'active', complianceLinked: false }) };
    });
  }
  if (method === 'GET' && rest === '/renewal-risk') {
    return send(200, ok({ mode: 'prepaid', balanceUsd: '2.0000', graceDays: 3, prealertDays: 7, numbers: state.numbers.filter((n) => !n.released_at).map((n) => ({ id: n.id, e164: n.e164, nextRenewalAt: '2026-11-20T00:00:00Z', rentUsd: '1.1500', status: 'ok', shortfallUsd: null, daysUntilRenewal: 12 })) }));
  }
  if (method === 'GET' && rest === '/reclaimable') {
    const rows = state.reclaimable ?? [];
    return send(200, ok({ numbers: rows, total: rows.length }));
  }
  if (method === 'GET' && rest === '/compliance/requirements') {
    if (!q.country || !q.type || !q.endUserType) {
      reply(400, 'Failed to deserialize query string: missing field', { 'Content-Type': 'text/plain' }, true);
      return true;
    }
    if ((q.provider ?? 'plivo') === 'exotel') return send(400, fail("provider 'exotel' does not support compliance"));
    return send(200, ok({ provider: q.provider ?? 'plivo', requirements: [{ document_type_id: 'dt1', name: 'Proof of address', description: 'a utility bill', proof_required: true, data_fields: [], required_fields: ['address'], raw: { big: 'x' } }] }));
  }
  if ((m = rest.match(/^\/([^/]+)\/reclaim$/)) && method === 'POST') {
    return replay(`reclaim:${m[1]}`, () => {
      const r = (state.reclaimable ?? []).find((x) => x.id === m[1]);
      if (!r) return { status: 400, body: fail('You released this number yourself, so it cannot be reclaimed — buy it again from Search.') };
      state.reclaimable = state.reclaimable.filter((x) => x.id !== m[1]);
      state.reclaims = (state.reclaims ?? 0) + 1;
      const row = numberRow(newId(), r.e164, { provider: r.provider });
      state.numbers.push(row);
      return { status: 200, body: ok({ status: 'restored', number: row, restore: { agentRestored: false, defaultOutboundRestored: false, poolRestored: false, inboundActionRestored: false, campaignsRelinked: 0, notes: [] }, chargedUsd: '1.1500' }) };
    });
  }
  if ((m = rest.match(/^\/([^/]+)\/assign-agent$/)) && method === 'POST') {
    const a = state.agents[body?.agentId];
    if (!a) return send(404, fail('Agent not found'));
    if (a.org_id !== me.org_id) return send(403, fail('Agent belongs to a different organization'));
    const n = live(m[1]);
    if (!n) return send(404, fail('Phone number not found'));
    Object.assign(n, { agent_id: body.agentId, is_default_outbound: false, inbound_action: null });
    return send(200, ok(n));
  }
  if ((m = rest.match(/^\/([^/]+)\/agent$/)) && method === 'DELETE') {
    const n = live(m[1]);
    if (!n) return send(404, fail('Phone number not found'));
    if (n.is_pool) return send(400, fail('this is a pool number and its agent is the routing fallback — unmark it first'));
    Object.assign(n, { agent_id: null, is_default_outbound: false });
    return send(200, ok(n));
  }
  if ((m = rest.match(/^\/([^/]+)\/default-outbound$/)) && method === 'POST') {
    const n = live(m[1]);
    if (!n) return send(404, fail('Phone number not found'));
    const on = body?.isDefault === true;
    if (on && !n.agent_id) return send(400, fail('Assign an agent to this number first'));
    if (on) for (const o of state.numbers) if (o.agent_id === n.agent_id) o.is_default_outbound = false;
    n.is_default_outbound = on;
    return send(200, ok(n));
  }
  if ((m = rest.match(/^\/([^/]+)\/inbound-action$/)) && method === 'POST') {
    const n = live(m[1]);
    if (!n) return send(404, fail('Phone number not found'));
    const action = body?.action ?? null;
    if (action !== null && !ACTIONS.includes(action)) return send(400, fail(`invalid inbound action '${action}'`));
    if (n.agent_id) return send(409, fail('This number is bound to an agent; the agent answers its calls.'));
    n.inbound_action = action;
    return send(200, ok(n));
  }
  if ((m = rest.match(/^\/([^/]+)$/))) {
    const n = live(m[1]);
    if (method === 'GET') return n ? send(200, ok(priced(n))) : send(404, fail('Phone number not found'));
    if (method === 'DELETE') {
      if (!n) return send(404, fail('Phone number not found'));
      if ((state.whatsappNumbers ?? []).includes(n.id)) return send(409, fail('This number is live on WhatsApp as “Support”. Remove that WhatsApp channel first, then release the number.'));
      n.released_at = '2026-11-08T12:00:00Z';
      return send(200, { success: true, message: 'Number released' });
    }
  }
  return false;
}
