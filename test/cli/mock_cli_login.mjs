/**
 * mock_cli_login.mjs — the browser-login routes of the test stand-in (CLI_BROWSER_LOGIN_PLAN.md §4).
 *
 * In here: `makeCliLoginState()` and `cliLoginRoute(rec, state, send)` → true when it answered.
 * It is called BEFORE the stand-in's key check, because start and token take no key:
 *   POST /api/cli-login/start   201 { success, data: { deviceCode, userCode, verificationUri,
 *                               verificationUriComplete, expiresIn, interval } }
 *   POST /api/cli-login/token   200 { success, data: { apiKey, keyId, keyName, keyRole, orgId, orgName,
 *                               expiresAt } } exactly once; else 400 { error } with an RFC 8628 code
 *   POST /api/v1/me/revoke      200 { revoked: true, keyId } (no envelope); 401 for a key it does not know
 * and the approval page's routes, with a person's login (`Authorization: Bearer <token>` from `people`):
 *   GET  /api/cli-login/requests/:userCode           200 { success, data: { userCode, hostname, os, cliVersion,
 *                                                    ip, createdAt, expiresAt, orgs: [{ id, name, myRole,
 *                                                    maxKeyRole }] } }; 404 unknown or decided
 *   POST /api/cli-login/requests/:userCode/approve   { orgId, role, name? } → 200 { success, data: { orgId, role } };
 *                                                    403 cli_login_role_too_high / cli_login_not_allowed; 404;
 *                                                    409 cli_login_decided
 *   POST /api/cli-login/requests/:userCode/deny      200
 * With `routes: false` all of them answer like a server older than browser login (voice_ai_rust
 * bfd2df4): its fallback's 404, plain text `Not Found` — every auth layer there is per route.
 * What the token route answers is scripted: `answers` is consumed one per poll —
 *   'pending' | 'slow_down' | 'deny' | 'expired_token' | 'approve' | 'http503' | { status, body, headers }
 * — and once it is empty every poll is 'pending', until `serverExpiryPolls` polls, after which
 * the server says `expired_token` (so a CLI that ignores `expiresIn` fails a test, not hangs it).
 * An approved request mints a key into `state.keys` (so `/api/v1/me` knows it) and is consumed:
 * a later poll gets `expired_token`, as the real `UPDATE … WHERE status = 'approved'` does.
 * Not in here: the other routes (`mock_server.mjs`, `mock_phase2.mjs`), the tests.
 * Called by: `mock_server.mjs`; tests read and set `state.cliLogin`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function makeCliLoginState() {
  return {
    routes: true,
    interval: 5,
    expiresIn: 600,
    /** The link the server sends; a test may make it hostile. */
    linkBase: undefined,
    userCode: 'WDJB-MJHT',
    answers: [],
    serverExpiryPolls: 50,
    /** What the minted key looks like. */
    mint: { keyRole: 'developer', expiresInDays: 90, orgId: undefined, orgName: 'Acme' },
    /** A signed-in person for the approval page's routes: token → the orgs they may make keys in. */
    people: {
      'person-token': { orgs: [{ id: undefined, name: 'Acme', myRole: 'developer', maxKeyRole: 'developer' }] },
    },
    /** deviceCode → { userCode, status, polls, body, decision } */
    requests: {},
    minted: [],
    revoked: [],
    seq: 0,
  };
}

const ok = (data) => ({ success: true, data });
const fail = (error, code) => ({ success: false, error, code });
const RANK = ['viewer', 'member', 'developer', 'admin', 'owner'];

/** The approval page's routes (a person's login); true when it answered. */
function pageRoute(rec, cl, send, defaults) {
  const m = rec.path.match(/^\/api\/cli-login\/requests\/([^/]+)(\/approve|\/deny)?$/);
  if (!m) return false;
  const person = cl.people[String(rec.headers.authorization ?? '').replace(/^Bearer /, '')];
  if (!person) return send(401, fail('Unauthorized', 'unauthorized')), true;
  const orgs = person.orgs.map((o) => ({ ...o, id: o.id ?? defaults.orgId }));
  const entry = Object.entries(cl.requests).reverse().find(([, r]) => r.userCode === decodeURIComponent(m[1]));
  const r = entry?.[1];
  const action = m[2];
  if (!action && rec.method === 'GET') {
    if (!r || r.status !== 'pending') return send(404, fail('No such sign-in request', 'not_found')), true;
    return send(200, ok({
      userCode: r.userCode, hostname: r.body?.hostname ?? null, os: r.body?.os ?? null, cliVersion: r.body?.cliVersion ?? null,
      ip: '127.0.0.1', createdAt: r.createdAt, expiresAt: r.expiresAt, orgs,
    })), true;
  }
  if (rec.method !== 'POST' || !action) return send(405, ''), true;
  if (!r) return send(404, fail('No such sign-in request', 'not_found')), true;
  if (r.status !== 'pending') return send(409, fail('This request was already decided', 'cli_login_decided')), true;
  if (action === '/deny') {
    r.status = 'denied';
    return send(200, ok({})), true;
  }
  const org = orgs.find((o) => o.id === rec.body?.orgId);
  if (!org) return send(403, fail('You cannot make keys in this org', 'cli_login_not_allowed')), true;
  const role = rec.body?.role;
  if (!RANK.includes(role) || RANK.indexOf(role) > RANK.indexOf(org.maxKeyRole)) {
    return send(403, fail('That role is above what you may give a key', 'cli_login_role_too_high')), true;
  }
  r.status = 'approved';
  r.decision = { orgId: org.id, orgName: org.name, role, name: rec.body?.name };
  return send(200, ok({ orgId: org.id, role })), true;
}

export function cliLoginRoute(rec, state, send, defaults) {
  const { method, path: p, body, headers } = rec;
  const cl = state.cliLogin;
  const isOurs =
    p === '/api/cli-login/start' || p === '/api/cli-login/token' || p === '/api/v1/me/revoke' || p.startsWith('/api/cli-login/requests/');
  if (!isOurs) return false;
  if (!cl.routes) {
    send(404, 'Not Found', { 'Content-Type': 'text/plain' }, true);
    return true;
  }
  if (pageRoute(rec, cl, send, defaults)) return true;
  if (method !== 'POST') {
    send(405, '', {}, true);
    return true;
  }

  if (p === '/api/cli-login/start') {
    const n = ++cl.seq;
    const deviceCode = `dc_secret_${n}_${'x'.repeat(40)}`;
    const linkBase = cl.linkBase ?? `${defaults.frontendUrl}/cli/authorize`;
    const now = Date.now();
    cl.requests[deviceCode] = {
      userCode: cl.userCode, status: 'pending', polls: 0, body,
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + cl.expiresIn * 1000).toISOString(),
    };
    send(201, ok({
      deviceCode,
      userCode: cl.userCode,
      verificationUri: linkBase,
      verificationUriComplete: cl.linkBase ? cl.linkBase : `${linkBase}?code=${cl.userCode}`,
      expiresIn: cl.expiresIn,
      interval: cl.interval,
    }));
    return true;
  }

  if (p === '/api/cli-login/token') {
    const r = cl.requests[body?.deviceCode];
    if (!r) {
      send(400, { error: 'expired_token' });
      return true;
    }
    r.polls++;
    if (r.status === 'consumed' || r.status === 'denied') {
      send(400, { error: r.status === 'denied' ? 'access_denied' : 'expired_token' });
      return true;
    }
    // Approved on the page: this poll gets the key. Otherwise the script, then 'pending'.
    let a = r.status === 'approved' ? 'approve' : cl.answers.length > 0 ? cl.answers.shift() : r.polls >= cl.serverExpiryPolls ? 'expired_token' : 'pending';
    if (typeof a === 'object') {
      send(a.status, a.body, a.headers ?? {}, typeof a.body === 'string');
      return true;
    }
    if (a === 'http503') {
      send(503, { success: false, error: 'Service Unavailable' });
      return true;
    }
    if (a === 'pending') return send(400, { error: 'authorization_pending' }), true;
    if (a === 'slow_down') return send(400, { error: 'slow_down' }), true;
    if (a === 'expired_token') return send(400, { error: 'expired_token' }), true;
    if (a === 'deny') {
      r.status = 'denied';
      send(400, { error: 'access_denied' });
      return true;
    }
    // approve: mint once — with what the page chose, else the defaults in `mint` — and consume the request.
    r.status = 'consumed';
    const m = cl.mint;
    const d = r.decision ?? {};
    const keyId = `kcli${cl.minted.length + 1}`;
    const apiKey = `vai_live_cli_minted_${cl.minted.length + 1}_secret`;
    const keyName = d.name ?? `telenow CLI — ${r.body?.hostname ?? 'unknown'} — 2026-11-08`;
    const keyRole = d.role ?? m.keyRole;
    const expiresAt = m.expiresInDays === null ? null : new Date(Date.now() + m.expiresInDays * DAY_MS).toISOString();
    const orgId = d.orgId ?? m.orgId ?? defaults.orgId;
    const orgName = d.orgName ?? m.orgName;
    state.keys[apiKey] = {
      org_id: orgId, org_name: orgName, key_id: keyId, key_name: keyName, key_role: keyRole, parent_org_id: null,
      ...(m.expired ? { expired: true } : {}),
    };
    cl.minted.push({ apiKey, keyId, deviceCode: body.deviceCode });
    send(200, ok({ apiKey, keyId, keyName, keyRole, orgId, orgName, expiresAt }));
    return true;
  }

  // POST /api/v1/me/revoke — key auth, any role, revokes the calling key.
  const key = headers['x-api-key'];
  const me = state.keys[key];
  if (!me || me.expired) {
    send(401, { success: false, error: 'Invalid API key', code: 'invalid_api_key' });
    return true;
  }
  delete state.keys[key];
  cl.revoked.push(me.key_id);
  send(200, { revoked: true, keyId: me.key_id });
  return true;
}
