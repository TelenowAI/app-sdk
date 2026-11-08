/**
 * mock_phase2.mjs — the phase 2 routes of the test stand-in (TELENOW_CLI_PLAN.md phase 2).
 *
 * In here: `phase2Route(rec, state, me, send)` → true when it answered. Shapes follow the route
 * research of 2026-11-08 (voice_ai_rust at main 588f6008), including the awkward parts:
 *   POST /api/sessions/initiate-call    201 { success, data:{ sessionId, status, callStatus, callId, phoneNumber } };
 *                                       queue:true → 202 { success, queued, campaignId, deduplicated, pendingAhead };
 *                                       a repeated Idempotency-Key replays with header Idempotent-Replay: true
 *   /api/orgs/:org/campaigns            org routes, { success, data }; start / pause / cancel answer
 *                                       { success, message } EVEN WHEN NOTHING CHANGED (only legal moves happen)
 *   /api/v1/campaigns/:id/targets       flat { added, duplicates, suppressed, skipped, without_id, withoutId, source };
 *                                       dedupe by (source, id); > 1000 targets → 400
 *   /api/v1/campaigns/:id/results       flat { results, nextCursor, nextSince }; unknown campaign → EMPTY list
 *   /api/orgs/:org/knowledge-bases      { success, data:{ knowledgeBases, total } } etc.; `state.knowledgeOff` → every
 *                                       path 404s with a generic message (module not mounted)
 *   /api/providers/tts/:p/voices        { success, source, data:[voice] } (no filters server-side)
 *   /api/orgs/:org/voices/clones        { success, data:{ clones } }
 *   /api/orgs/:org/dnc                  { success, data:{ entries, total } }; add 201; import → { added, skipped };
 *                                       DELETE → { success, message }
 *   /api/orgs/:org/webhooks             create 201 { success, data:{ endpoint, signing_secret } }; DELETE answers
 *                                       success even for an unknown id; test 202 { success, data:{ delivery, deduplicated } };
 *                                       GET one delivery { delivery } (snake_case row); replay 202 { delivery (camelCase),
 *                                       deduplicated } — owner/admin, Idempotency-Key required, coded refusals
 *   /api/orgs/:org/agents/:a/knowledge-bases   GET each base with `document_ids` (null = whole); POST /:kb with
 *                                       `{ documentIds }` sets the scope, without it a new row is whole and an existing
 *                                       one is UNCHANGED; PUT replaces the whole set
 *   /api/v1/events/sample?type=         200 sample for a known event, 400 listing the known ones otherwise
 *   /api/orgs/:org/analytics            { success, data:{ from, to, totalCalls, daily, agents } }
 * Multipart bodies are kept as raw text in the request record, for the tests to read.
 * Called by: `mock_server.mjs`.
 */

export const EVENTS = ['call.completed', 'call.started', 'campaign.completed'];

const ok = (data) => ({ success: true, data });
const fail = (error, extra = {}) => ({ success: false, error, ...extra });
const writer = (me) => ['owner', 'admin', 'developer'].includes(me.key_role);

let seq = 0;
const newId = (p) => `${p}${String(++seq).padStart(7, '0')}-0000-4000-8000-000000000000`;

export async function phase2Route(rec, state, me, send) {
  const { method, path: p, query: q, body, headers } = rec;
  let m;
  state.idem ??= {};
  const replayable = (key, compute) => {
    const k = headers['idempotency-key'];
    if (k && state.idem[`${key}|${k}`]) {
      const r = state.idem[`${key}|${k}`];
      send(r.status, r.body, { 'Idempotent-Replay': 'true' });
      return true;
    }
    const r = compute();
    if (k && r.status < 300) state.idem[`${key}|${k}`] = r;
    send(r.status, r.body);
    return true;
  };

  if (method === 'POST' && p === '/api/sessions/initiate-call') {
    state.dialled ??= [];
    return replayable('call', () => {
      if (!state.agents[body?.agentId]) return { status: 404, body: fail('Agent not found') };
      if ((state.dnc ?? []).some((e) => e.phone_number === body.mobileNumber)) {
        return { status: 403, body: fail(`${body.mobileNumber} is on this organization's Do-Not-Call list and cannot be dialed`) };
      }
      state.dialled.push(body);
      if (body.queue) return { status: 202, body: { success: true, queued: true, campaignId: newId('q'), deduplicated: false, pendingAhead: 0 } };
      return { status: 201, body: ok({ sessionId: newId('s'), status: 'active', callStatus: 'initiated', callId: 'CA123', phoneNumber: body.mobileNumber }) };
    });
  }

  if ((m = p.match(/^\/api\/orgs\/([^/]+)(\/.*)?$/))) {
    if (m[1] !== me.org_id) {
      send(403, fail('This API key is scoped to a different organization.'));
      return true;
    }
    const rest = m[2] ?? '';
    let r;

    // ---- campaigns (org) ----
    state.campaigns ??= {};
    if (rest === '/campaigns' && method === 'GET') {
      const all = Object.values(state.campaigns);
      send(200, ok({ campaigns: all, total: all.length }));
      return true;
    }
    if (rest === '/campaigns' && method === 'POST') {
      return replayable('campaign', () => {
        const c = { id: newId('k'), name: body.name, agent_id: body.agentId, status: 'draft', total_targets: 0, completed_targets: 0, failed_targets: 0, timezone: body.timezone ?? 'UTC', start_time_local: body.startTimeLocal ?? null, end_time_local: body.endTimeLocal ?? null, created_at: 't' };
        state.campaigns[c.id] = c;
        return { status: 201, body: ok(c) };
      });
    }
    if ((r = rest.match(/^\/campaigns\/([^/]+)(\/[a-z/]+)?$/))) {
      const c = state.campaigns[r[1]];
      const sub = r[2] ?? '';
      if (sub === '' && method === 'GET') {
        send(c ? 200 : 404, c ? ok({ ...c, agent_uses_dtmf: false, dial_block: null }) : fail('campaign not found'));
        return true;
      }
      const moves = { '/start': [['draft', 'paused'], 'running', 'campaign started'], '/pause': [['running'], 'paused', 'campaign paused'], '/cancel': [['draft', 'running', 'paused'], 'cancelled', 'campaign cancelled'] };
      if (method === 'POST' && moves[sub]) {
        const [from, to, msg] = moves[sub];
        if (c && from.includes(c.status)) c.status = to; // nothing changes otherwise — and it still answers success
        send(200, { success: true, message: msg });
        return true;
      }
      if (sub === '/targets' && method === 'POST') {
        if (!c) return send(404, fail('campaign not found')), true;
        const text = typeof body === 'string' ? body : '';
        // Rows of the uploaded CSV inside the multipart body: lines that start with a + number
        // (boundary and part-header lines never do).
        const csv = text.split(/\r?\n/).filter((l) => /^\+\d/.test(l));
        c.total_targets += csv.length;
        if (c.status === 'completed') c.status = 'running';
        send(200, ok({ added: csv.length, suppressed: 0 }));
        return true;
      }
      if (sub === '/calls' && method === 'GET') {
        const calls = state.campaignCalls?.[r[1]] ?? [];
        const lim = Number(q.limit ?? 50);
        const off = Number(q.offset ?? 0);
        const rows = calls.filter((x) => !q.status || x.status === q.status);
        send(200, ok({ calls: rows.slice(off, off + lim), total: rows.length, statusCounts: { completed: rows.length }, failedTotal: 0, failedUnanswered: 0 }));
        return true;
      }
      if (sub === '/analytics' && method === 'GET') {
        send(200, ok({ targets: c?.total_targets ?? 0, dialled: 0, reached: 0 }));
        return true;
      }
    }

    // ---- knowledge bases ----
    if (rest.startsWith('/knowledge-bases') || /^\/agents\/[^/]+\/knowledge-bases/.test(rest)) {
      if (state.knowledgeOff) return send(404, fail('Not Found')), true;
      state.kbs ??= {};
      if (rest === '/knowledge-bases' && method === 'GET') {
        const all = Object.values(state.kbs);
        send(200, ok({ knowledgeBases: all, total: all.length }));
        return true;
      }
      if (rest === '/knowledge-bases' && method === 'POST') {
        return replayable('kb', () => {
          const kb = { id: newId('b'), name: body.name, description: body.description ?? null, document_count: null, docs: [] };
          state.kbs[kb.id] = kb;
          return { status: 201, body: ok(kb) };
        });
      }
      if ((r = rest.match(/^\/knowledge-bases\/([^/]+)(\/documents(?:\/upload|\/url)?)?$/))) {
        const kb = state.kbs[r[1]];
        if (!kb) return send(404, fail('knowledge base not found')), true;
        if (!r[2] && method === 'GET') return send(200, ok({ ...kb, document_count: kb.docs.length })), true;
        if (!r[2] && method === 'DELETE') {
          delete state.kbs[r[1]];
          return send(200, { success: true, message: 'knowledge base deleted' }), true;
        }
        if (r[2] === '/documents' && method === 'GET') return send(200, ok({ documents: kb.docs, total: kb.docs.length })), true;
        if (r[2] && method === 'POST') {
          const doc = { id: newId('d'), kb_id: kb.id, title: body?.title ?? 'upload', status: 'pending', source_type: r[2].endsWith('url') ? 'url' : r[2].endsWith('upload') ? 'upload' : 'inline' };
          kb.docs.push(doc);
          // The real create answers the whole Document, its full text (`body`) included (found 11-08 on the box).
          return send(201, ok({ ...doc, body: typeof body === 'string' ? body : body?.body ?? '' })), true;
        }
      }
      // An agent's bases, as the server keeps them: `state.attached` maps "agent|kb" → document_ids (null = whole).
      state.attached ??= new Map();
      const scopeErr = (kb, ids) => {
        if (ids.length === 0) return 'document scope cannot be empty — attach the whole base instead by omitting documentIds';
        const missing = ids.filter((d) => !kb.docs.some((x) => x.id === d));
        return missing.length ? `document_not_in_base: ${missing.join(', ')} not found in this knowledge base` : null;
      };
      if ((r = rest.match(/^\/agents\/([^/]+)\/knowledge-bases$/))) {
        if (method === 'GET') {
          const rows = [...state.attached].filter(([k]) => k.startsWith(`${r[1]}|`)).map(([k, ids]) => {
            const kb = state.kbs[k.split('|')[1]];
            return { id: kb.id, name: kb.name, document_count: kb.docs.length, document_ids: ids };
          });
          return send(200, ok({ knowledgeBases: rows, total: rows.length })), true;
        }
        if (method === 'PUT') {
          if (!Array.isArray(body?.knowledgeBases)) return send(422, 'missing field `knowledgeBases`'), true;
          for (const b of body.knowledgeBases) {
            const kb = state.kbs[b.kbId];
            if (!kb) return send(404, fail('knowledge base not found')), true;
            if (Array.isArray(b.documentIds) && b.documentIds.length > 0) {
              const err = scopeErr(kb, b.documentIds);
              if (err) return send(400, fail(err)), true;
            }
          }
          state.kbPuts = (state.kbPuts ?? 0) + 1;
          for (const k of [...state.attached.keys()]) if (k.startsWith(`${r[1]}|`)) state.attached.delete(k);
          for (const b of body.knowledgeBases) state.attached.set(`${r[1]}|${b.kbId}`, Array.isArray(b.documentIds) ? [...new Set(b.documentIds)] : null);
          if (state.hooks.afterKbPut) state.hooks.afterKbPut(r[1]);
          return send(200, { success: true, message: 'knowledge bases updated' }), true;
        }
      }
      if ((r = rest.match(/^\/agents\/([^/]+)\/knowledge-bases\/([^/]+)$/))) {
        const kb = state.kbs[r[2]];
        if (!kb) return send(404, fail('knowledge base not found')), true;
        const key = `${r[1]}|${r[2]}`;
        if (method === 'DELETE') {
          state.attached.delete(key);
          return send(200, { success: true, message: 'knowledge base detached' }), true;
        }
        if (method === 'POST') {
          // The real route reads the body as Option<Json>: no body, a body that is not JSON, or one without
          // `documentIds` all mean "no scope" — a new row is the whole base, an existing one keeps its scope.
          const ids = body && typeof body === 'object' && Array.isArray(body.documentIds) ? body.documentIds : null;
          if (ids) {
            const err = scopeErr(kb, ids);
            if (err) return send(400, fail(err)), true;
            state.attached.set(key, [...new Set(ids)]);
          } else if (!state.attached.has(key)) {
            state.attached.set(key, null);
          }
          return send(200, { success: true, message: 'knowledge base attached' }), true;
        }
      }
    }

    // ---- voices (org) ----
    if (rest === '/voices/clones' && method === 'GET') {
      send(200, ok({ clones: (state.clones ?? []).filter((c) => c.provider === q.provider) }));
      return true;
    }

    // ---- do-not-call ----
    state.dnc ??= [];
    if (rest === '/dnc' && method === 'GET') {
      const rows = state.dnc.filter((e) => !q.search || e.phone_number.includes(q.search));
      const lim = Number(q.limit ?? 100);
      const off = Number(q.offset ?? 0);
      send(200, ok({ entries: rows.slice(off, off + lim), total: rows.length }));
      return true;
    }
    if (rest === '/dnc' && method === 'POST') {
      if (!writer(me)) return send(403, fail("This API key's role ('viewer') is read-only on this endpoint.")), true;
      const e = { id: newId('n'), phone_number: body.phoneNumber, reason: body.reason ?? null, source: 'manual' };
      state.dnc.push(e);
      send(201, ok(e));
      return true;
    }
    if (rest === '/dnc/import' && method === 'POST') {
      const lines = String(body).split(/\r?\n/).filter((l) => /^\+\d/.test(l.trim()));
      for (const l of lines) state.dnc.push({ id: newId('n'), phone_number: l.trim().split(',')[0], source: 'csv' });
      send(200, ok({ added: lines.length, skipped: 0 }));
      return true;
    }
    if ((r = rest.match(/^\/dnc\/([^/]+)$/)) && method === 'DELETE') {
      const i = state.dnc.findIndex((e) => e.id === r[1]);
      if (i < 0) return send(404, fail('dnc entry not found')), true;
      state.dnc.splice(i, 1);
      send(200, { success: true, message: 'dnc entry removed' });
      return true;
    }

    // ---- webhooks ----
    state.hooks2 ??= {};
    if (rest === '/webhooks' && method === 'GET') {
      const all = Object.values(state.hooks2).filter((h) => !h.disabled_at);
      send(200, ok({ endpoints: all, total: all.length }));
      return true;
    }
    if (rest === '/webhooks' && method === 'POST') {
      return replayable('hook', () => {
        const h = { id: newId('w'), url: body.url, events: body.events ?? ['*'], agent_id: body.agentId ?? null };
        state.hooks2[h.id] = h;
        return { status: 201, body: ok({ endpoint: h, signing_secret: 'wh_secret_test_only' }) };
      });
    }
    if ((r = rest.match(/^\/webhooks\/([^/]+)(\/test|\/deliveries)?$/))) {
      const h = state.hooks2[r[1]];
      if (!r[2] && method === 'DELETE') {
        if (h) h.disabled_at = 't';
        return send(200, { success: true, message: 'webhook disabled' }), true; // even for an unknown id
      }
      if (r[2] === '/test' && method === 'POST') {
        if (!h) return send(404, fail('Webhook endpoint not found')), true;
        return send(202, ok({ delivery: { id: newId('v'), status: 'pending', eventType: body.eventType }, deduplicated: false })), true;
      }
      if (r[2] === '/deliveries' && method === 'GET') {
        return send(200, ok({ deliveries: [{ id: 'v1', event_type: 'call.completed', status: 'delivered', payload: { big: true } }], total: 1 })), true;
      }
    }
    // One delivery, and its replay (owner / admin; Idempotency-Key required; coded refusals).
    state.deliveries2 ??= {};
    if ((r = rest.match(/^\/webhooks\/([^/]+)\/deliveries\/([^/]+)(\/replay)?$/))) {
      const h = state.hooks2[r[1]];
      const d = state.deliveries2[r[2]];
      const code = (status, error, c, extra = {}) => send(status, fail(error, { code: c, ...extra }));
      if (!r[3] && method === 'GET') {
        if (!h || h.disabled_at) return send(404, fail('Webhook endpoint not found')), true;
        if (!d) return send(404, fail('Delivery not found')), true;
        return send(200, ok({ delivery: d })), true;
      }
      if (r[3] && method === 'POST') {
        if (!['owner', 'admin'].includes(me.key_role)) return send(403, fail(`this API key's role (${me.key_role}) cannot do this — requires one of: owner, admin`)), true;
        if (!h || h.disabled_at) return send(404, fail('Webhook endpoint not found')), true;
        if (!d) return send(404, fail('Delivery not found')), true;
        const k = headers['idempotency-key'];
        if (!k) return code(400, 'a replay needs an Idempotency-Key header (one per click)', 'idempotency_key_required'), true;
        state.replayClicks ??= {};
        // The same key again: within a day the idempotency layer answers with the FIRST answer (deduplicated: false)
        // and `Idempotent-Replay: true`; once that cache is gone (`state.replayCacheGone`), the service's own click
        // check answers `deduplicated: true`. Either way nothing is sent twice.
        if (state.replayClicks[k]) {
          if (state.replayCacheGone) return send(202, ok({ delivery: state.replayClicks[k], deduplicated: true })), true;
          return send(202, ok({ delivery: state.replayClicks[k], deduplicated: false }), { 'Idempotent-Replay': 'true' }), true;
        }
        if (!['delivered', 'dead'].includes(d.status)) {
          return code(409, 'this delivery is still being retried; it can be replayed once it is delivered or has given up', 'webhook_delivery_not_finished', { status: d.status, nextAttemptAt: d.next_attempt_at }), true;
        }
        if (state.replayOff) return code(503, 'test events and replays are off: WEBHOOK_MANUAL_SENDS_PER_HOUR is not set', 'webhook_manual_send_unconfigured', { setting: 'WEBHOOK_MANUAL_SENDS_PER_HOUR' }), true;
        const v = { id: newId('v'), endpointId: h.id, eventType: d.event_type, status: 'pending', deliveryKind: d.delivery_kind === 'test' ? 'test' : 'replay', replayOf: d.id, attempt: 0, createdAt: '2026-11-08T12:00:00Z' };
        state.replayClicks[k] = v;
        state.replays = (state.replays ?? 0) + 1;
        return send(202, ok({ delivery: v, deduplicated: false })), true;
      }
    }

    // ---- analytics ----
    if (rest === '/analytics' && method === 'GET') {
      send(200, ok({ from: q.from ?? 'f', to: q.to ?? 't', totalCalls: 3, daily: [], agents: [] }));
      return true;
    }
    return false;
  }

  // ---- v1 campaigns ----
  if ((m = p.match(/^\/api\/v1\/campaigns\/([^/]+)\/(targets|results)$/))) {
    state.campaigns ??= {};
    const c = state.campaigns[m[1]];
    if (m[2] === 'targets' && method === 'POST') {
      if (!Array.isArray(body?.targets) || body.targets.length === 0) return send(400, fail('targets must not be empty')), true;
      if (body.targets.length > 1000) return send(400, fail('at most 1000 targets per request')), true;
      if (state.failPushAfter !== undefined && (state.pushes = (state.pushes ?? 0) + 1) > state.failPushAfter) {
        return send(503, fail('busy')), true;
      }
      state.pushed ??= new Set();
      let added = 0;
      let duplicates = 0;
      let withoutId = 0;
      for (const t of body.targets) {
        if (t.id === undefined) withoutId++;
        const k = `${body.source}|${t.id}`;
        if (t.id !== undefined && state.pushed.has(k)) duplicates++;
        else {
          if (t.id !== undefined) state.pushed.add(k);
          added++;
        }
      }
      if (c) c.total_targets += added;
      send(200, { added, duplicates, suppressed: 0, skipped: 0, without_id: withoutId, withoutId, source: `push|${body.source}` });
      return true;
    }
    if (m[2] === 'results' && method === 'GET') {
      const all = c ? state.results?.[m[1]] ?? [] : [];
      const start = q.cursor ? Number(q.cursor) : 0;
      const lim = Number(q.limit ?? 500);
      const page = all.slice(start, start + lim);
      send(200, { results: page, nextCursor: start + lim < all.length ? String(start + lim) : null, nextSince: null });
      return true;
    }
  }

  if (method === 'GET' && p === '/api/v1/events/sample') {
    if (EVENTS.includes(q.type)) send(200, { type: q.type, sample: {} });
    else send(400, fail(`unknown event type '${q.type}'; valid: ${EVENTS.join(', ')}`));
    return true;
  }

  if ((m = p.match(/^\/api\/providers\/tts\/([^/]+)\/voices$/)) && method === 'GET') {
    const voices = state.voices?.[m[1]];
    send(200, voices ? { success: true, source: 'live', data: voices } : { success: true, source: 'fallback', data: [] });
    return true;
  }
  return false;
}
