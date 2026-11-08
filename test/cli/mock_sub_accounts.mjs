/**
 * mock_sub_accounts.mjs — `/api/v1/sub-accounts` of the test stand-in (TELENOW_CLI_PLAN.md §15, step 4e).
 *
 * In here: `subAccountsRoute(rec, state, me, reply)` → true when it answered. Shapes follow voice_ai_rust main (bfd2df4,
 * `features/sub_accounts/{routes,service,wire}.rs`): FLAT JSON (no `{ success, data }`), bodies STRICT (an unknown field
 * → 400 "invalid JSON body: unknown field …"), every route owner/admin only (403 otherwise, reads included):
 *   GET    /                list `{ subAccounts, total, limit, offset }` (`status`, `externalId`, `limit`, `offset`)
 *   POST   /                201 `{ subAccount, apiKey: { id, key, lastFour, name, role, createdAt } }`; keyRole admin |
 *                           developer | viewer (default admin); externalId taken → 409
 *   GET    /:id             the view + `usage: { monthToDateSpendUsd, activeCalls }` (`state.subLive[id]`)
 *   PATCH  /:id             nothing to change → 400; closed → 409
 *   POST   /:id/suspend     optional `{ reason }`; closed → 409; `state.subEnded[id]` counts the calls ended
 *   POST   /:id/resume
 *   POST   /:id/keys        `revokeExisting` absent = TRUE (every live key revoked) → 201 `{ subAccountId, revokedKeys, apiKey }`
 *   DELETE /:id             numbers held (`state.subNumbers[id]`) → 409; closes and revokes every key
 *   GET    /:id/usage       `from` / `to` RFC 3339 (else 400); from ≥ to → 400
 * A minted key is added to `state.keys`, so it really works (`whoami`) until it is revoked (then 401). Every create body
 * is kept in `state.subCreates`.
 * Called by: `mock_server.mjs`.
 */

const fail = (error) => ({ success: false, error });
const ROLES = ['admin', 'developer', 'viewer'];
const CREATE_FIELDS = ['name', 'externalId', 'limits', 'keyName', 'keyRole'];
const UPDATE_FIELDS = ['name', 'externalId', 'limits'];
const LIMIT_FIELDS = ['maxConcurrentCalls', 'monthlySpendLimitUsd', 'totalSpendLimitUsd'];
let seq = 0;

function strict(body, allowed) {
  if (body === undefined || body === null || typeof body !== 'object') return null;
  const extra = Object.keys(body).find((k) => !allowed.includes(k));
  if (extra) return `invalid JSON body: unknown field \`${extra}\``;
  if (body.limits && typeof body.limits === 'object') {
    const bad = Object.keys(body.limits).find((k) => !LIMIT_FIELDS.includes(k));
    if (bad) return `invalid JSON body: unknown field \`${bad}\``;
  }
  return null;
}

export async function subAccountsRoute(rec, state, me, reply) {
  const { method, path: p, query: q, body } = rec;
  if (!p.startsWith('/api/v1/sub-accounts')) return false;
  state.subs ??= {};
  state.subCreates ??= [];
  state.subLive ??= {};
  state.subEnded ??= {};
  state.subNumbers ??= {};
  const send = (status, b) => {
    reply(status, b);
    return true;
  };
  if (!['owner', 'admin'].includes(me.key_role)) {
    return send(403, fail(`this API key's role (${me.key_role}) cannot do this — requires one of: owner, admin`));
  }
  const mine = (id) => {
    const s = state.subs[id];
    return s && s.parent === me.org_id ? s : null;
  };
  const view = (s) => {
    const { parent: _p, keys: _k, ...v } = s;
    return { ...v, usage: { monthToDateSpendUsd: 0, activeCalls: state.subLive[s.id] ?? 0 } };
  };
  const mint = (s, role, name) => {
    const id = `k-${++seq}`;
    const key = `vai_live_sub_${seq}_${Math.random().toString(36).slice(2, 12)}`;
    state.keys[key] = { org_id: s.id, org_name: s.name, key_id: id, key_name: name ?? 'Sub-account key', key_role: role, parent_org_id: me.org_id };
    s.keys.push(key);
    return { id, key, lastFour: key.slice(-4), name: name ?? 'Sub-account key', role, createdAt: '2026-11-08T12:00:00Z' };
  };
  const revokeAll = (s) => {
    let n = 0;
    for (const k of s.keys) if (state.keys[k]) (delete state.keys[k], n++);
    s.keys = [];
    return n;
  };
  const limitsOf = (l = {}, base = { maxConcurrentCalls: null, monthlySpendLimitUsd: null, totalSpendLimitUsd: null }) => {
    const out = { ...base };
    for (const f of LIMIT_FIELDS) if (f in l) out[f] = l[f] === null ? null : Number(l[f]);
    return out;
  };
  let m;

  if (p === '/api/v1/sub-accounts' && method === 'GET') {
    if (q.status && !['active', 'suspended', 'closed'].includes(q.status)) return send(400, fail('status must be one of: active, suspended, closed'));
    const all = Object.values(state.subs).filter((s) => s.parent === me.org_id && (!q.status || s.status === q.status) && (!q.externalId || s.externalId === q.externalId));
    const limit = Math.min(Math.max(Number(q.limit ?? 50), 1), 200);
    const offset = Number(q.offset ?? 0);
    return send(200, { subAccounts: all.slice(offset, offset + limit).map(view), total: all.length, limit, offset });
  }
  if (p === '/api/v1/sub-accounts' && method === 'POST') {
    state.subCreates.push(body);
    const bad = strict(body, CREATE_FIELDS);
    if (bad || !body) return send(400, fail(bad ?? 'invalid JSON body: EOF'));
    if (!body.name || !String(body.name).trim()) return send(400, fail('name is required'));
    const role = body.keyRole ?? 'admin';
    if (!ROLES.includes(role)) return send(400, fail('keyRole must be one of: admin, developer, viewer'));
    if (body.externalId && Object.values(state.subs).some((s) => s.parent === me.org_id && s.externalId === body.externalId)) {
      return send(409, fail("externalId is already used by another of this account's sub-accounts"));
    }
    const id = `5ab00000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
    const s = { id, parent: me.org_id, name: body.name, externalId: body.externalId ?? null, status: 'active', limits: limitsOf(body.limits), suspendedAt: null, suspendedReason: null, closedAt: null, createdAt: 't', updatedAt: 't', keys: [] };
    state.subs[id] = s;
    const apiKey = mint(s, role, body.keyName);
    return send(201, { subAccount: view(s), apiKey });
  }
  if (!(m = p.match(/^\/api\/v1\/sub-accounts\/([^/]+)(\/suspend|\/resume|\/keys|\/usage)?$/))) return false;
  const s = mine(m[1]);
  if (!s) return send(404, fail('sub-account not found'));
  const rest = m[2];
  if (!rest && method === 'GET') return send(200, view(s));
  if (!rest && method === 'PATCH') {
    const bad = strict(body, UPDATE_FIELDS);
    if (bad || !body) return send(400, fail(bad ?? 'invalid JSON body: EOF'));
    if (!('name' in body) && !('externalId' in body) && !('limits' in body)) return send(400, fail('nothing to update — send name, externalId or limits'));
    if (s.status === 'closed') return send(409, fail('This sub-account is closed.'));
    if ('name' in body) s.name = body.name;
    if ('externalId' in body) s.externalId = body.externalId;
    if (body.limits) s.limits = limitsOf(body.limits, s.limits);
    return send(200, view(s));
  }
  if (!rest && method === 'DELETE') {
    if (s.status !== 'closed') {
      const n = state.subNumbers[s.id] ?? 0;
      if (n > 0) return send(409, fail(`Release this sub-account's ${n} phone number(s) before closing it`));
      s.status = 'closed';
      s.closedAt = 't';
    }
    revokeAll(s);
    state.subEnded[s.id] = (state.subEnded[s.id] ?? 0) + (state.subLive[s.id] ?? 0);
    state.subLive[s.id] = 0;
    return send(200, view(s));
  }
  if (rest === '/suspend' && method === 'POST') {
    const bad = body === undefined ? null : strict(body, ['reason']);
    if (bad) return send(400, fail(bad));
    if (s.status === 'closed') return send(409, fail('This sub-account is closed.'));
    s.status = 'suspended';
    s.suspendedAt = 't';
    s.suspendedReason = body?.reason ?? null;
    state.subEnded[s.id] = (state.subEnded[s.id] ?? 0) + (state.subLive[s.id] ?? 0);
    state.subLive[s.id] = 0;
    return send(200, view(s));
  }
  if (rest === '/resume' && method === 'POST') {
    if (s.status === 'closed') return send(409, fail('This sub-account is closed.'));
    s.status = 'active';
    s.suspendedAt = null;
    return send(200, view(s));
  }
  if (rest === '/keys' && method === 'POST') {
    const bad = body === undefined ? null : strict(body, ['keyName', 'keyRole', 'revokeExisting']);
    if (bad) return send(400, fail(bad));
    if (s.status === 'closed') return send(409, fail('This sub-account is closed.'));
    const role = body?.keyRole ?? 'admin';
    if (!ROLES.includes(role)) return send(400, fail('keyRole must be one of: admin, developer, viewer'));
    const revoked = body?.revokeExisting === false ? 0 : revokeAll(s);
    const apiKey = mint(s, role, body?.keyName);
    return send(201, { subAccountId: s.id, revokedKeys: revoked, apiKey });
  }
  if (rest === '/usage' && method === 'GET') {
    const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;
    for (const k of ['from', 'to']) if (q[k] && !iso.test(q[k])) return send(400, fail(`${k} must be an RFC 3339 timestamp, e.g. 2026-10-01T00:00:00Z`));
    if (q.from && q.to && Date.parse(q.from) >= Date.parse(q.to)) return send(400, fail('from must be before to'));
    return send(200, { subAccountId: s.id, from: q.from ?? '2026-11-01T00:00:00Z', to: q.to ?? '2026-11-08T12:00:00Z', calls: 3, billableSeconds: 180, spendUsd: 0.42, activeCalls: state.subLive[s.id] ?? 0, monthToDateSpendUsd: 0.42, totalSpendUsd: 1.5, limits: s.limits, status: s.status });
  }
  return false;
}
