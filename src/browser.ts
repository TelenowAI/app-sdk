// telenow/browser — the in-dashboard runtime for an app's React UI.
//
// Your built UI runs inside a SANDBOXED iframe in the Telenow dashboard. It has
// no auth token and cannot reach the API directly; instead the dashboard
// injects a `window.telenow` bridge that relays your data calls to the parent,
// which performs them under the logged-in user's session (scoped to your app).
//
// This module is a thin, typed wrapper over that bridge. It has NO node deps —
// safe to bundle into the browser. (Server-side helpers live in the root entry.)

export interface AppRecord<T = Record<string, unknown>> {
  id: string;
  appId: string;
  objectType: string;
  data: T;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** The signed-in dashboard user + org role, for client-side RBAC. The platform
 *  enforces real permissions server-side on every call; this is for UI gating. */
export interface TelenowUser {
  id: string;
  /** Org role: owner | admin | developer | viewer | member | null. */
  role: string | null;
  /** Permissions the role grants (e.g. "view", "manage_agents", "monitor_calls"). */
  permissions: string[];
  /** Name + email are only present when the app declared the `user:profile` scope. */
  name?: string;
  email?: string;
}

/** Where in the app the user navigated (the active manifest page) + who they are. */
export interface TelenowContext {
  appId: string;
  pageId: string;
  /** Alias of pageId — the active view your app should render. */
  page: string;
  title: string;
  user?: TelenowUser | null;
}

export interface TelenowAgentSummary {
  id: string;
  name: string;
}

/** A call from the org's history (snake_case, projected from the call log). */
export interface CallRecord {
  id: string;
  agent_id?: string;
  agent_name?: string;
  /** telephony | softphone | web_call | whatsapp | web_chat */
  channel?: string;
  /** inbound | outbound | web | whatsapp */
  direction?: string;
  from_number?: string;
  to_number?: string;
  status?: string;
  duration_sec?: number;
  start_time?: string;
  end_time?: string;
  [k: string]: unknown;
}

export interface WhatsappChannel {
  id: string;
  [k: string]: unknown;
}

export interface TelenowAgents {
  /** List the org's agents (id + name) — needs the `agents:read` scope. */
  list(): Promise<TelenowAgentSummary[]>;
  /** Build a real voice agent from one of THIS app's bundled agent templates
   *  (declared in `manifest.agents`) and open it in the builder. The new agent is
   *  auto-bound to your app's tools. Needs `agents:read` + an owner/admin user. */
  createFromTemplate(templateId: string): Promise<{ agentId: string; kind: 'single' | 'flow' }>;
  /** Build a whole multi-agent TEAM from one of THIS app's team templates
   *  (declared in `manifest.agentTeams`): every member is created, auto-bound to
   *  your tools, and the handoffs are wired. Opens the entry agent in the builder.
   *  Needs `agents:read` + an owner/admin user. */
  createTeamFromTemplate(teamId: string): Promise<{
    teamId: string;
    entryAgentId: string | null;
    agents: { ref: string; agentId: string | null; kind: 'single' | 'flow' }[];
  }>;
}

export interface TelenowCalls {
  /** Place an outbound AI voice call — needs `calls:initiate`. `variables` fills
   *  the agent's {placeholder} context variables. */
  initiate(
    agentId: string,
    phone: string,
    variables?: Record<string, string>,
  ): Promise<{ sessionId?: string; status?: string }>;
  /** Read the org's call history — needs `calls:read`. */
  history(filters?: Record<string, string>): Promise<CallRecord[]>;
}

export interface TelenowWhatsapp {
  /** List WhatsApp channels — needs `whatsapp:send`. */
  channels(): Promise<WhatsappChannel[]>;
  /** Send a WhatsApp message from a channel to a number — needs `whatsapp:send`. */
  send(channelId: string, to: string, message: string): Promise<{ ok: true }>;
}

export interface TelenowSoftphone {
  /** Open the dashboard softphone prefilled with `phone` for the user to dial
   *  (the call runs in the dashboard, not your app). Needs `softphone:dial`. */
  dial(phone: string): Promise<{ ok: true; opened: true }>;
}

export interface AppSessionToken {
  /** A short-lived JWT (HS256, signed with your app's signing secret). */
  token: string;
  /** Seconds until it expires. */
  expiresIn: number;
}

export interface TelenowSession {
  /** Mint a short-lived JWT your app's BACKEND can verify (with the signing
   *  secret you already have) to trust {user, org, role, app}. The token's
   *  `aud` is `app:<id>`. For server-to-server identity — the in-iframe
   *  `telenow.user` is for UI RBAC only. Needs `session:token`. */
  token(): Promise<AppSessionToken>;
}

/** One live event streamed off an in-progress call. `topic` is the public event
 *  name (`call.turn`, `call.transcript_partial`, `call.barge_in`, `call.silence`,
 *  `call.dtmf`, `call.node_entered`); `data` is the event-specific payload. */
export interface LiveCallFrame {
  topic: string;
  sessionId: string;
  data: Record<string, unknown>;
}

export interface TelenowStream {
  /** Subscribe to a LIVE call's event stream (lifecycle + partial transcript).
   *  Resolves to an unsubscribe function. Needs the `calls:read` scope. The host
   *  holds the WebSocket and relays frames — your iframe never opens a socket. */
  subscribe(sessionId: string, onEvent: (frame: LiveCallFrame) => void): Promise<() => void>;
}

/** One stored blob's metadata (no bytes). */
export interface TelenowFileMeta {
  path: string;
  contentType?: string | null;
  sizeBytes: number;
  updatedAt: string;
}

/** Per-app private blob storage (C7). Bytes are org+app scoped — strictly your
 *  app's files in the installing org. `put`/`delete` need `files:write`;
 *  `get`/`list` need `files:read`. */
export interface TelenowFiles {
  /** List your stored files, optionally filtered to a path prefix. */
  list(prefix?: string): Promise<TelenowFileMeta[]>;
  /** Upload/overwrite a file. `path` is a logical key (e.g. "exports/q3.csv"). */
  put(path: string, body: ArrayBuffer | string | Blob): Promise<{ path: string; size: number }>;
  /** Download a file's raw bytes. */
  get(path: string): Promise<ArrayBuffer>;
  /** Delete a file. */
  delete(path: string): Promise<{ deleted: boolean }>;
}

export interface TelenowHttpRequest {
  /** Absolute https URL — its host must be in your declared `http:<host>` scopes. */
  url: string;
  /** GET (default) | POST | PUT | PATCH | DELETE | HEAD. */
  method?: string;
  /** Request headers — e.g. `{ Authorization: 'Bearer …' }` (your own bearer). */
  headers?: Record<string, string>;
  /** Body — a string is sent as-is; anything else is JSON-encoded. */
  body?: unknown;
  /** A stored connection provider id (e.g. "salesforce"): the platform injects
   *  its credential server-side, so the secret never enters your code. Overrides
   *  any `Authorization` header. Needs the `connection:<provider>` scope. */
  connection?: string;
}

export interface TelenowHttpResponse {
  status: number;
  headers: Record<string, string>;
  /** Response body as text (cap 1 MB) — `JSON.parse` it if you expect JSON. */
  body: string;
}

export interface TelenowSettings {
  /** All non-secret per-install config values (admin-configured in the dashboard).
   *  Secret settings are NEVER present here — they're injected server-side only. */
  all(): Record<string, unknown>;
  /** One non-secret config value by key. */
  get<T = unknown>(key: string): T | undefined;
}

/** Sort + limit for `data.list`. */
export interface QueryOpts {
  orderBy?: { field: string; desc?: boolean; numeric?: boolean };
  limit?: number;
  /** Apply a manifest-declared saved view (overrides filter + sort). */
  view?: string;
  /** Relation fields to expand — each embeds the referenced row(s) on every
   *  result as `{field}__expanded` (a to-one object, or an array when `many`). */
  expand?: string[];
  /** Natural-language query — rank rows by meaning instead of recency. Requires
   *  the object to declare `semantic: true`. */
  search?: string;
}

export interface TelenowData {
  /** Filtered list. `query` values are equality by default, or an operator
   *  object: `{ slot_start: { $gte: '2026-07-01', $lt: '2026-07-08' } }`.
   *  Operators: $eq $ne $gt $gte $lt $lte $in (array) $contains (substring). */
  list<T = Record<string, unknown>>(
    objectType: string,
    query?: Record<string, unknown>,
    opts?: QueryOpts,
  ): Promise<AppRecord<T>[]>;
  /** Count matching rows (same filter shape as `list`). */
  count(objectType: string, query?: Record<string, unknown>): Promise<{ count: number }>;
  create<T = Record<string, unknown>>(objectType: string, body: Partial<T>): Promise<AppRecord<T>>;
  update<T = Record<string, unknown>>(
    objectType: string,
    id: string,
    body: Partial<T>,
  ): Promise<AppRecord<T>>;
  remove(objectType: string, id: string): Promise<{ ok: true }>;
  /** Realtime — live-update instead of polling. `onChange` fires on every
   *  create / update / delete of `objectType` in this app. Resolves to an
   *  unsubscribe function; call it when the view unmounts. */
  subscribe(
    objectType: string,
    onChange: (change: ObjectChangeEvent) => void,
  ): Promise<() => void>;
}

/** A realtime object-change frame (Wave 3 #2). `data` is the row for
 *  created/updated, null for deleted. */
export interface ObjectChangeEvent<T = Record<string, unknown>> {
  event: 'created' | 'updated' | 'deleted';
  objectType: string;
  id: string;
  data: T | null;
}

export interface TelenowBridge {
  context: TelenowContext;
  /** The signed-in user (null if unavailable). */
  user: TelenowUser | null;
  /** Non-secret per-install config (admin-configured). Secrets never appear here. */
  settings: TelenowSettings;
  data: TelenowData;
  agents: TelenowAgents;
  calls: TelenowCalls;
  whatsapp: TelenowWhatsapp;
  softphone: TelenowSoftphone;
  session: TelenowSession;
  /** Live call event stream (lifecycle + partial transcript; needs calls:read). */
  stream: TelenowStream;
  /** Per-app private blob storage (needs files:read / files:write). */
  files: TelenowFiles;
  /** Call a third-party API through the dashboard's server-side proxy
   *  (host-allowlisted to your `http:<host>` scopes, SSRF-guarded). The browser
   *  never reaches the API directly — no CORS, and stored creds stay server-side. */
  http(request: TelenowHttpRequest): Promise<TelenowHttpResponse>;
}

declare global {
  interface Window {
    telenow?: TelenowBridge;
  }
}

// ── Mock bridge — for `telenow dev` standalone preview ──────────────────────
//
// Implements the full TelenowBridge against in-memory state (optionally
// persisted to localStorage), so your app runs in a plain browser tab with no
// dashboard, no server, and no auth. Data CRUD is real (equality-filtered like
// the platform); agents/calls/whatsapp/softphone/session return believable
// stubs; http() refuses (use live preview for real third-party calls).

export interface MockBridgeOptions {
  /** Active context — `page` decides which view your app renders. */
  context?: Partial<TelenowContext>;
  /** The signed-in user surfaced to your UI (defaults to a mock owner). */
  user?: TelenowUser | null;
  /** Seed rows per object type, e.g. `{ patient: [{ name: 'Asha' }] }`. */
  seed?: Record<string, Array<Record<string, unknown>>>;
  agents?: TelenowAgentSummary[];
  calls?: CallRecord[];
  whatsappChannels?: WhatsappChannel[];
  /** Non-secret per-install config values surfaced via `telenow.settings`. */
  settings?: Record<string, unknown>;
  /** Persist created/updated data to localStorage (default true in a browser). */
  persist?: boolean;
  /** localStorage key (default derived from the app id). */
  storageKey?: string;
  /** Log each bridge call to the console (default true) so you can see activity. */
  log?: boolean;
}

function mockId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return 'mock-' + Math.floor(Math.random() * 1e9).toString(36) + Date.now().toString(36);
}

/**
 * Build a fully-functional fake `window.telenow` for local development.
 * `telenow dev` calls this; you can also use it in your own test harness:
 * `window.telenow = createMockBridge({ seed: { note: [{ title: 'Hi' }] } })`.
 */
export function createMockBridge(opts: MockBridgeOptions = {}): TelenowBridge {
  const appId = opts.context?.appId ?? 'dev-app';
  const logOn = opts.log !== false;
  const persist =
    opts.persist !== false && typeof localStorage !== 'undefined';
  const storeKey = opts.storageKey ?? `telenow.dev.data.${appId}`;
  const note = (op: string, detail?: unknown) => {
    if (logOn) console.info(`[telenow mock] ${op}`, detail ?? '');
  };

  // ---- data store -----------------------------------------------------------
  type Store = Record<string, AppRecord[]>;
  let store: Store = {};
  const load = () => {
    if (persist) {
      try {
        const raw = localStorage.getItem(storeKey);
        if (raw) return JSON.parse(raw) as Store;
      } catch {
        /* ignore corrupt cache */
      }
    }
    return null;
  };
  const save = () => {
    if (persist) {
      try {
        localStorage.setItem(storeKey, JSON.stringify(store));
      } catch {
        /* quota / unavailable — stay in-memory */
      }
    }
  };
  const loaded = load();
  if (loaded) {
    store = loaded;
  } else {
    // First run: materialise the seed into records.
    const now = new Date().toISOString();
    for (const [type, rows] of Object.entries(opts.seed ?? {})) {
      store[type] = (rows ?? []).map((data) => ({
        id: mockId(),
        appId,
        objectType: type,
        data,
        createdBy: 'mock-user',
        createdAt: now,
      }));
    }
    save();
  }

    // Mirrors the server operators ($gt/$gte/$lt/$lte/$ne/$in/$contains) so a
    // `telenow dev` mock behaves like production.
    const opMatch = (field: unknown, ops: Record<string, unknown>): boolean =>
    Object.entries(ops).every(([op, ov]) => {
      const fs = String(field ?? '');
      const numeric = typeof ov === 'number';
      const a: number | string = numeric ? Number(fs) : fs;
      const b = ov as number | string;
      switch (op) {
        case '$eq': return fs === String(ov);
        case '$ne': return fs !== String(ov);
        case '$gt': return a > b;
        case '$gte': return a >= b;
        case '$lt': return a < b;
        case '$lte': return a <= b;
        case '$in': return Array.isArray(ov) && ov.map(String).includes(fs);
        case '$contains': return fs.toLowerCase().includes(String(ov).toLowerCase());
        default: return true;
      }
    });
  const matches = (rec: AppRecord, query?: Record<string, unknown>) =>
    !query ||
    Object.entries(query).every(([k, v]) => {
      const field = (rec.data as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((o) => o.startsWith('$'))) {
        return opMatch(field, v as Record<string, unknown>);
      }
      return String(field ?? '') === String(v);
    });

  const data: TelenowData = {
    async list(objectType, query, opts) {
      note('data.list', { objectType, query, opts });
      let rows = ((store[objectType] ?? []) as AppRecord[]).filter((r) =>
        matches(r, query as Record<string, unknown> | undefined),
      );
      if (opts?.orderBy) {
        const { field, desc, numeric } = opts.orderBy;
        rows = [...rows].sort((a, b) => {
          const av = (a.data as Record<string, unknown>)[field];
          const bv = (b.data as Record<string, unknown>)[field];
          const cmp = numeric
            ? Number(av ?? 0) - Number(bv ?? 0)
            : String(av ?? '').localeCompare(String(bv ?? ''));
          return desc ? -cmp : cmp;
        });
      } else {
        rows = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      }
      if (opts?.limit) rows = rows.slice(0, opts.limit);
      return rows as never;
    },
    async count(objectType, query) {
      note('data.count', { objectType, query });
      return {
        count: ((store[objectType] ?? []) as AppRecord[]).filter((r) =>
          matches(r, query as Record<string, unknown> | undefined),
        ).length,
      };
    },
    async create(objectType, body) {
      note('data.create', { objectType, body });
      const rec: AppRecord = {
        id: mockId(),
        appId,
        objectType,
        data: { ...(body as Record<string, unknown>) },
        createdBy: 'mock-user',
        createdAt: new Date().toISOString(),
      };
      (store[objectType] ??= []).unshift(rec);
      save();
      return rec as never;
    },
    async update(objectType, id, body) {
      note('data.update', { objectType, id, body });
      const rec = (store[objectType] ?? []).find((r) => r.id === id);
      if (!rec) throw new Error(`mock: ${objectType} ${id} not found`);
      rec.data = { ...rec.data, ...(body as Record<string, unknown>) };
      rec.updatedAt = new Date().toISOString();
      save();
      return rec as never;
    },
    async remove(objectType, id) {
      note('data.remove', { objectType, id });
      store[objectType] = (store[objectType] ?? []).filter((r) => r.id !== id);
      save();
      return { ok: true };
    },
    async subscribe(objectType) {
      // Standalone dev has no live backend — no-op stream, returns an unsubscribe.
      note('data.subscribe', { objectType });
      return () => {};
    },
  };

  const user: TelenowUser =
    opts.user ?? {
      id: 'mock-user',
      role: 'owner',
      permissions: ['view', 'manage_agents', 'manage_members', 'manage_billing', 'monitor_calls'],
      name: 'Dev User',
      email: 'dev@example.com',
    };

  const context: TelenowContext = {
    appId,
    pageId: opts.context?.pageId ?? opts.context?.page ?? 'home',
    page: opts.context?.page ?? opts.context?.pageId ?? 'home',
    title: opts.context?.title ?? 'Dev preview',
    user,
  };

  const unavailable = (what: string) =>
    Promise.reject(
      new Error(`[telenow mock] ${what} isn't available in standalone dev — use \`telenow dev --connect\` (live preview) to exercise real ${what}.`),
    );

  // In-memory blob store for the mock files API (not persisted).
  const mockFiles = new Map<
    string,
    { body: ArrayBuffer | string | Blob; size: number; updatedAt: string }
  >();
  const bodySize = (body: ArrayBuffer | string | Blob): number =>
    typeof body === 'string'
      ? body.length
      : body instanceof ArrayBuffer
        ? body.byteLength
        : (body as Blob).size ?? 0;

  return {
    context,
    user,
    settings: {
      all: () => opts.settings ?? {},
      get: <T = unknown>(key: string) => (opts.settings ?? {})[key] as T | undefined,
    },
    data,
    agents: {
      async list() {
        note('agents.list');
        return opts.agents ?? [
          { id: 'mock-agent-1', name: 'Front Desk (mock)' },
          { id: 'mock-agent-2', name: 'Sales Bot (mock)' },
        ];
      },
      async createFromTemplate(templateId) {
        note('agents.createFromTemplate', { templateId });
        return { agentId: mockId(), kind: 'single' as const };
      },
      async createTeamFromTemplate(teamId) {
        note('agents.createTeamFromTemplate', { teamId });
        const entry = mockId();
        return {
          teamId,
          entryAgentId: entry,
          agents: [{ ref: 'entry', agentId: entry, kind: 'flow' as const }],
        };
      },
    },
    calls: {
      async initiate(agentId, phone, variables) {
        note('calls.initiate', { agentId, phone, variables });
        return { sessionId: mockId(), status: 'queued' };
      },
      async history() {
        note('calls.history');
        return opts.calls ?? [];
      },
    },
    whatsapp: {
      async channels() {
        note('whatsapp.channels');
        return opts.whatsappChannels ?? [{ id: 'mock-wa-1', kind: 'web' }];
      },
      async send(channelId, to, message) {
        note('whatsapp.send', { channelId, to, message });
        return { ok: true };
      },
    },
    softphone: {
      async dial(phone) {
        note('softphone.dial', { phone });
        return { ok: true, opened: true };
      },
    },
    session: {
      async token() {
        note('session.token');
        return { token: 'mock.dev.session.token', expiresIn: 1800 };
      },
    },
    stream: {
      async subscribe(sessionId, _onEvent) {
        note('stream.subscribe', { sessionId });
        // No live frames in the mock — return a no-op unsubscribe.
        return () => note('stream.unsubscribe', { sessionId });
      },
    },
    files: {
      async list(prefix) {
        note('files.list', { prefix });
        return [...mockFiles.entries()]
          .filter(([p]) => !prefix || p.startsWith(prefix))
          .map(([path, f]) => ({
            path,
            contentType: 'application/octet-stream',
            sizeBytes: f.size,
            updatedAt: f.updatedAt,
          }));
      },
      async put(path, body) {
        note('files.put', { path });
        const size = bodySize(body);
        mockFiles.set(path, { body, size, updatedAt: new Date().toISOString() });
        return { path, size };
      },
      async get(path) {
        note('files.get', { path });
        const f = mockFiles.get(path);
        if (!f) throw new Error('file not found');
        if (typeof f.body === 'string') return new TextEncoder().encode(f.body).buffer as ArrayBuffer;
        if (f.body instanceof ArrayBuffer) return f.body;
        return (f.body as Blob).arrayBuffer();
      },
      async delete(path) {
        note('files.delete', { path });
        return { deleted: mockFiles.delete(path) };
      },
    },
    http() {
      return unavailable('http() proxy calls');
    },
  };
}

/** The injected bridge. Throws if not running inside the Telenow dashboard. */
export function getTelenow(): TelenowBridge {
  if (typeof window === 'undefined' || !window.telenow) {
    throw new Error(
      'Telenow bridge unavailable — this UI must run inside the Telenow dashboard iframe.',
    );
  }
  return window.telenow;
}

/** True when the bridge is present (e.g. to render a dev-mode placeholder). */
export function hasTelenow(): boolean {
  return typeof window !== 'undefined' && !!window.telenow;
}

/** Convenience accessors. */
export const telenowData = (): TelenowData => getTelenow().data;
export const telenowContext = (): TelenowContext => getTelenow().context;
export const telenowUser = (): TelenowUser | null => getTelenow().user;
export const telenowAgents = (): TelenowAgents => getTelenow().agents;
export const telenowCalls = (): TelenowCalls => getTelenow().calls;
export const telenowWhatsapp = (): TelenowWhatsapp => getTelenow().whatsapp;
export const telenowSoftphone = (): TelenowSoftphone => getTelenow().softphone;
export const telenowSession = (): TelenowSession => getTelenow().session;
export const telenowSettings = (): TelenowSettings => getTelenow().settings;
export const telenowHttp = (request: TelenowHttpRequest): Promise<TelenowHttpResponse> =>
  getTelenow().http(request);
