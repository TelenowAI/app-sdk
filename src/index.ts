// telenow — SDK for building installable apps on the Telenow App Platform.
//
// An external app: (1) verifies the platform's signed requests (agent tool calls
// + event webhooks), and (2) reads/writes its own records via the scoped Data
// API using a per-install app key. Zero runtime deps — Node 18+ (node:crypto +
// global fetch).

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Manifest types (mirror the platform's `telenow.app.json`)
// ---------------------------------------------------------------------------

export interface FieldDef {
  key: string;
  type?: string;
  index?: boolean;
  values?: string[];
  default?: unknown;
}

export interface ObjectDef {
  type: string;
  label?: string;
  fields?: FieldDef[];
}

export type HandlerKind =
  | 'object.create'
  | 'object.query'
  | 'object.update'
  | 'object.delete'
  | 'http'
  | 'sandbox';

export interface ToolHandler {
  kind: HandlerKind;
  object?: string;
  /** object.update / object.delete: field used to locate the (newest) record. */
  match?: string;
  /** object.update: constant fields always set. */
  set?: Record<string, unknown>;
  /** http: path appended to base_url. */
  path?: string;
  method?: string;
  /** sandbox: JS function body run in the hardened runtime. */
  code?: string;
}

export interface ToolDef {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  handler: ToolHandler;
  timeoutSecs?: number;
  handoff?: string;
}

export interface WhenPredicate {
  path: string;
  equals?: unknown;
}

/** Subscribable event topics. The coarse `call.started`/`call.ended`/
 *  `call.analyzed`/`recording.ready` + `object.<type>.created` fire on their own.
 *  The MID-CALL topics (`call.turn`/`call.barge_in`/`call.silence`/`call.dtmf`/
 *  `call.node_entered`) stream LIVE during the call and carry transcript content,
 *  so they additionally require the app to hold the `calls:read` scope. Each
 *  webhook payload is `{ event, appId, data: { sessionId, ...fields } }`, signed
 *  with `x-telenow-signature: sha256=<hmac>` using your install signing secret. */
export type AppEventTopic =
  | 'call.started'
  | 'call.ended'
  | 'call.analyzed'
  | 'recording.ready'
  | 'call.turn'
  | 'call.barge_in'
  | 'call.silence'
  | 'call.dtmf'
  | 'call.node_entered'
  | `object.${string}.created`
  | (string & {});

export interface EventDef {
  /** The topic to subscribe to. Mid-call `call.*` topics need the `calls:read` scope. */
  on: AppEventTopic;
  handler: {
    kind: 'rule' | 'webhook';
    do?: string;
    object?: string;
    key?: string;
    when?: WhenPredicate;
    map?: Record<string, string>;
    /** webhook: path appended to base_url. */
    path?: string;
  };
}

/** A scheduled job: run `handler` (usually a webhook to your backend) every
 *  fixed interval. `every` is "30m" | "1h" | "6h" | "24h" | "1d" — not a full
 *  cron expression. Minimum 5 minutes. */
export interface ScheduleDef {
  /** Stable id, unique within the app. */
  key: string;
  /** Interval between runs, e.g. "1h" or "24h". */
  every: string;
  handler: EventDef['handler'];
}

/** A dashboard page = one sidebar menu item. Mounts the app's React bundle with
 *  this page id active; the app routes internally on the active page id. */
export interface UiPage {
  /** Stable id, unique within the app — route segment + active-view key. */
  id: string;
  title?: string;
  /** Whitelisted icon name (see the dashboard icon registry). */
  icon?: string;
  /** Show as a sidebar menu item (false ⇒ reachable in-app only). */
  menu?: boolean;
  /** Optional submenu grouping under the app. */
  group?: string;
}

/** The dashboard UI an app contributes: one built React bundle (`entry`,
 *  produced by `telenow build`) served inside a sandboxed iframe, plus the menu
 *  pages it exposes. `entry`/`styles` are package-relative paths at publish time
 *  and are rewritten to stored URLs by the platform. */
export interface UiConfig {
  entry?: string;
  styles?: string;
  pages?: UiPage[];
  /** Render one of your pages into a platform slot (C6). */
  extensions?: UiExtension[];
}

/** Named platform surfaces a UI extension can target. */
export type UiSlot = 'call_detail_panel' | 'dashboard_widget';

/** Declares that the app renders `pageId` into a platform `slot`. The page also
 *  receives the slot's read-only context (e.g. `telenow.context.callId`). */
export interface UiExtension {
  slot: UiSlot;
  /** References a `pages[].id` declared in this manifest. */
  pageId: string;
  title?: string;
  icon?: string;
}

/** A marketplace listing screenshot. Authored with `file` (a package-relative
 *  image path); the platform stores it and serves it back as `url`. */
export interface Screenshot {
  /** Stored URL (serve time). */
  url?: string;
  /** Package-relative image path (author time; bundled by `telenow build`). */
  file?: string;
  caption?: string;
}

/** One per-install configuration field. `secret` values are encrypted at rest
 *  and only ever injected server-side — never sent to the app UI. */
export interface SettingDef {
  key: string;
  label?: string;
  /** text | textarea | number | boolean | select | secret. Absent ⇒ text. */
  type?: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'secret';
  required?: boolean;
  secret?: boolean;
  default?: unknown;
  options?: { value: string; label?: string }[];
  help?: string;
  group?: string;
}

/** A ready-made agent your app ships. The agent-spec fields are authored as
 *  natural top-level keys; for a MULTI-CONTEXT agent, put a flow graph under
 *  `metadata.flow` ({ nodes, edges }). On "Create agent" these build a real
 *  agent auto-bound to your app's tools. */
export interface AppAgentTemplate {
  /** Stable id, unique within the app. */
  id: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  /** Defaults: openai / gpt-4o-mini. */
  llmProvider?: string;
  llmModel?: string;
  sttProvider?: string;
  ttsProvider?: string;
  ttsVoice?: string;
  /** Greeting/recording/behaviour block. */
  sessionConfig?: Record<string, unknown>;
  /** Put a `{ flow: { nodes, edges } }` graph here for a multi-context agent. */
  metadata?: Record<string, unknown>;
  /** Any further agent-spec fields (forward-compat). */
  [key: string]: unknown;
}

/** A multi-agent TEAM your app ships: several member agents wired by handoffs. On
 *  "Create team", every member is built + auto-bound to your tools, and each
 *  member's handoff references (a sibling's `ref`, used as the placeholder
 *  `agentId` in its flow `agent` nodes) are rewritten to the real agent ids. */
export interface AppAgentTeam {
  /** Stable id, unique within the app. */
  id: string;
  name?: string;
  description?: string;
  /** The `ref` of the member the call starts on. */
  entry: string;
  members: AppAgentTeamMember[];
}

/** One team member — an agent spec plus a team-local `ref` that sibling handoffs
 *  target. Same flattened agent-spec fields as `AppAgentTemplate`. */
export interface AppAgentTeamMember {
  /** Team-local id, unique within the team. */
  ref: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  llmProvider?: string;
  llmModel?: string;
  sttProvider?: string;
  ttsProvider?: string;
  ttsVoice?: string;
  sessionConfig?: Record<string, unknown>;
  /** For handoff, put a `{ flow: { nodes:[{type:'agent',config:{agents:[{agentId:'<siblingRef>'}]}}] } }` graph here. */
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Manifest {
  id: string;
  version: string;
  name?: string;
  runtime?: 'declarative' | 'external' | 'sandboxed';
  /** external: base URL of your service that http tool/webhook handlers hit. */
  base_url?: string;
  scopes?: string[];
  objects?: ObjectDef[];
  tools?: ToolDef[];
  /** Dashboard UI: React bundle + menu pages. */
  ui?: UiConfig;
  events?: EventDef[];
  /** Scheduled jobs run on a fixed interval (e.g. nightly sweeps). */
  schedules?: ScheduleDef[];
  /** Per-install config fields, rendered as an admin form. */
  settings?: SettingDef[];
  /** Ready-made agents your app ships — installing the app lets the org build a
   *  working voice agent in one click, auto-wired to your tools. */
  agents?: AppAgentTemplate[];
  /** Multi-agent teams your app ships — one click builds the whole set with the
   *  handoffs wired (e.g. a triage agent + specialists). */
  agentTeams?: AppAgentTeam[];
  /** Marketplace listing copy (markdown), bundled from README.md by the CLI. */
  readme?: string;
  /** Per-version "what's new" notes (markdown), bundled from CHANGELOG.md by the CLI. */
  changelog?: string;
  /** Marketplace listing screenshots. */
  screenshots?: Screenshot[];
}

// ---------------------------------------------------------------------------
// Inbound request shapes (what the platform POSTs to your app)
// ---------------------------------------------------------------------------

export interface CallerEnvelope {
  number?: string;
  identifier?: string;
  channel?: string;
  session_id?: string;
}

/** Body of an agent tool call (`http` handler) → POST {base_url}{path}. */
export interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
  caller?: CallerEnvelope;
}

/** Body of an event webhook (`webhook` handler) → POST {base_url}{path}. */
export interface EventRequest {
  event: string;
  appId: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the platform's `X-Telenow-Signature: sha256=<hex>` over the RAW request
 * body, in constant time. Use this on every inbound tool call and webhook.
 *
 *   const ok = verifySignature(signingSecret, rawBody, req.header('x-telenow-signature'));
 *   if (!ok) return res.status(401).end();
 */
export function verifySignature(
  signingSecret: string,
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;
  const expectedHex = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  let a: Buffer;
  try {
    a = Buffer.from(provided, 'hex');
  } catch {
    return false;
  }
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// App session token (verify the user identity on YOUR backend)
// ---------------------------------------------------------------------------

/** Claims inside an app session token (from `telenow.session.token()`). */
export interface AppSessionClaims {
  /** Subject — the acting user's id. */
  sub: string;
  /** Only present when the app was granted the `user:profile` scope. */
  email?: string;
  org_id: string;
  app_id: string;
  /** The user's org role. */
  role: string;
  /** `app:<app_id>`. */
  aud: string;
  exp: number;
  iat: number;
  jti: string;
}

/**
 * Verify an app session token on YOUR backend (HS256, signed with your app's
 * signing secret — the same one `verifySignature` uses). Checks signature +
 * expiry, and `aud === "app:<appId>"` when `appId` is given. Returns the claims
 * or throws.
 *
 *   const claims = verifyAppToken(req.headers.authorization!.slice(7), SIGNING_SECRET, 'my-app');
 *   // → { sub, org_id, role, ... } — trust this user.
 */
export function verifyAppToken(
  token: string,
  signingSecret: string,
  appId?: string,
): AppSessionClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, sig] = parts;
  const expected = createHmac('sha256', signingSecret).update(`${h}.${p}`).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, 'base64url');
  } catch {
    throw new Error('bad signature');
  }
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    throw new Error('bad signature');
  }
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as AppSessionClaims;
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw new Error('token expired');
  }
  if (appId && claims.aud !== `app:${appId}`) {
    throw new Error('aud mismatch');
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Scoped Data API client (read/write your app's records)
// ---------------------------------------------------------------------------

export interface AppObject<T = Record<string, unknown>> {
  id: string;
  appId: string;
  objectType: string;
  data: T;
  createdBy?: string | null;
  createdAt: string;
  updatedAt?: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Client for the scoped Data API. The app key is bound to one (org, app), so
 * every call is automatically scoped to your app's data in the installing org.
 *
 *   const db = new DataClient('https://api.telenow.ai', process.env.TELENOW_APP_KEY!);
 *   const { objects } = await db.list('appointment', { phone: '+91...' });
 *   await db.create('appointment', { phone, slot_start });
 */
export class DataClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly appKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async req<R>(method: string, path: string, body?: unknown): Promise<R> {
    const res = await fetch(`${this.baseUrl}/api/app-data${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.appKey}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as Envelope<R>;
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Data API ${method} ${path} failed (${res.status})`);
    }
    return json.data as R;
  }

  /** List records of a type, with optional equality filters on stored fields. */
  list<T = Record<string, unknown>>(
    objectType: string,
    filter: Record<string, string> = {},
  ): Promise<{ objects: AppObject<T>[] }> {
    const qs = new URLSearchParams(filter).toString();
    return this.req('GET', `/${encodeURIComponent(objectType)}${qs ? `?${qs}` : ''}`);
  }

  /** Create a record. */
  create<T = Record<string, unknown>>(objectType: string, data: T): Promise<AppObject<T>> {
    return this.req('POST', `/${encodeURIComponent(objectType)}`, data);
  }

  /** Merge-update a record by id. */
  update<T = Record<string, unknown>>(
    objectType: string,
    id: string,
    patch: Partial<T>,
  ): Promise<AppObject<T>> {
    return this.req('PATCH', `/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`, patch);
  }

  /** Delete a record by id. */
  remove(objectType: string, id: string): Promise<void> {
    return this.req('DELETE', `/${encodeURIComponent(objectType)}/${encodeURIComponent(id)}`);
  }
}
