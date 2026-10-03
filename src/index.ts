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
  | 'call.machine_detected'
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
  /** Declarative UI the PLATFORM renders in its own components — no iframe.
   *
   *  `extensions` embeds your page; `contributions` describes what you want and
   *  lets the host draw it. That is the only way to reach places an iframe
   *  structurally cannot go (a cell in the host's table, an item in its row menu,
   *  a button in its list toolbar), and because there is no foreign document
   *  there is nothing to style-match and no theme to keep in sync.
   *
   *  Use a contribution for the ENTRY POINT and a page (usually `modal: true`)
   *  for the work itself. */
  contributions?: UiContribution[];
}

/** Named platform surfaces a UI extension can target. */
export type UiSlot =
  | 'call_detail_panel'
  | 'dashboard_widget'
  | 'agent_builder_panel'
  | 'agents_overview_panel'
  | 'call_list_panel'
  | 'softphone_call_panel'
  /** Beside a campaign's target importer. Context: `campaignId`, `agentId`. */
  | 'campaign_targets_panel';

/** Declares that the app renders `pageId` into a platform `slot`. The page also
 *  receives the slot's read-only context (e.g. `telenow.context.callId`). */
export interface UiExtension {
  slot: UiSlot;
  /** References a `pages[].id` declared in this manifest. */
  pageId: string;
  title?: string;
  icon?: string;
}

/** Host lists a contribution can attach to. */
export type UiSurface = 'campaign_targets' | 'campaigns_list' | 'calls_list' | 'agents_list';

/** What a contribution renders. A closed set on purpose: an app able to draw
 *  arbitrary markup inside the dashboard could draw a convincing fake login. */
export type UiContributionKind = 'list_action' | 'column' | 'row_action' | 'bulk_action';

/** One declarative contribution the platform renders with its OWN components. */
export interface UiContribution {
  kind: UiContributionKind;
  surface: UiSurface;
  /** Stable key, NOT a label — the host uses it as a React key and sends it back
   *  when the user activates the contribution. Rename `label` freely; changing
   *  `id` makes it a different contribution. */
  id: string;
  /** Button label, column header, or menu item text. Required for every kind. */
  label: string;
  icon?: string;
  /** The page to open. Required for every kind EXCEPT `column`, which renders
   *  values rather than acting. Must reference a `pages[].id`. */
  pageId?: string;
  /** Open `pageId` as a modal instead of navigating — what a form or mapper wants. */
  modal?: boolean;
  /** `column` only. */
  align?: 'left' | 'right' | 'center';
  description?: string;
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

/** Fields of a finished call you can map into your object.
 *
 *  The same reference language the dashboard's own call destinations use, so
 *  `analysis.custom.interested` means one thing everywhere.
 *
 *  - `call.outcome` — `answered` | `no-answer` | `busy` | `failed`
 *  - `call.to` `call.from` `call.ended_at` `call.attempt`
 *  - `keypad.digits` `keypad.choices` — what the caller pressed and what each
 *    press meant. Campaign calls only; a postCall capture resolves them to
 *    nothing, because `call.completed` does not carry the keypad log.
 *  - `analysis.summary` `analysis.sentiment` `analysis.disposition` `analysis.topics`
 *  - `analysis.custom.<name>` — whatever your agent extracts
 *  - `var.<name>` — a context variable
 *  - `'literal'` — fixed text, in single quotes
 */
export type CallFieldRef = string;

export interface PostCallDef {
  /** One of your own `objects[].type`. Rejected at publish if you never declared it. */
  object: string;
  /** `{ "<field on your object>": "<call field ref>" }`. Rejected at publish when
   *  empty — it would store a blank row for every call. */
  mapping: Record<string, CallFieldRef>;
  /** Which outcomes to store. Omit for all of them — an app asking for post-call
   *  capture almost always wants the unanswered calls too, which is the whole
   *  reason this exists rather than `call.ended`. */
  firesOn?: ('answered' | 'no-answer' | 'busy' | 'failed')[];
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
  /** Store every finished call into one of your own objects — declaratively, with
   *  no handler and no server to run. Applies to every agent your app is bound to,
   *  exactly as `tools` do, and resolved from the manifest at delivery time so an
   *  edit takes effect on the next call. */
  postCall?: PostCallDef;
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

/** One call from `/api/app-calls` (camelCase wire shape). */
export interface AppCall {
  id: string;
  agentId: string;
  agentName?: string | null;
  status: string;
  callMode: string;
  channel: 'softphone' | 'whatsapp' | 'telephony' | 'web_call' | 'web_chat';
  direction: string;
  startTime: string;
  endTime?: string | null;
  durationSec?: number | null;
  fromNumber?: string | null;
  toNumber?: string | null;
  answeredBy?: string | null;
  disposition?: string | null;
  wrapupDisposition?: string | null;
  hasRecording: boolean;
  latency: {
    sttMsAvg?: number | null;
    llmMsAvg?: number | null;
    ttsMsAvg?: number | null;
    netRttMsAvg?: number | null;
    respMsAvg?: number | null;
    respMsMax?: number | null;
    respSamples?: number | null;
    audioGapCount?: number | null;
  };
  createdAt: string;
  /** Present when requested (`includeAnalysis`) / on `get`. Null until the
   * post-call worker has analyzed the call. */
  analysis?: CallAnalysisResult | null;
  /** Only on `get`: the durable transcript (system turns hidden). `agentId`
   *  is the agent that spoke each turn — it changes across an agent-to-agent
   *  handoff, so resolve it through `participants` to label each turn. */
  transcript?: { role: string; text: string; at: string; agentId?: string | null }[];
  /** Only on `get`: id→name for every agent that participated on the call
   *  (≥2 entries after a handoff). Resolve each turn's `agentId` through this. */
  participants?: Record<string, string>;
}

/** Post-call analysis row (camelCase; see the platform's analysis docs). */
export interface CallAnalysisResult {
  sessionId: string;
  status: string;
  summary?: string | null;
  sentiment?: string | null;
  sentimentScore?: number | null;
  disposition?: string | null;
  actionItems: unknown;
  customData: unknown;
  qa: unknown;
  objections: unknown;
  score?: number | null;
  coaching: unknown;
  topics: unknown;
  keywords: unknown;
  agentWords: number;
  customerWords: number;
  agentTurns: number;
  customerTurns: number;
  [key: string]: unknown;
}

export interface ListCallsParams {
  agentId?: string;
  /** call_mode filter: "agent" | "manual". */
  mode?: string;
  status?: string;
  /** RFC3339 window on startTime: from inclusive, to exclusive. */
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'longest' | 'shortest';
  includeAnalysis?: boolean;
  /** Page size, 1–200 (default 50). */
  limit?: number;
  offset?: number;
}

export interface ListCallsPage {
  calls: AppCall[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Client for the call history + live-stream API (`/api/app-calls`) — the
 * surface analytics apps are built on. Visibility follows your granted scope:
 * `calls:read` sees calls of agents the install is BOUND to; `calls:read:org`
 * (consented org-wide at install) sees every agent's calls.
 *
 *   const calls = new CallsClient('https://api.telenow.ai', process.env.TELENOW_APP_KEY!);
 *   let page = await calls.list({ from: '2026-07-01T00:00:00Z', includeAnalysis: true });
 *   while (page.hasMore) { ...; page = await calls.list({ offset: page.offset + page.limit }); }
 */
export class CallsClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly appKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async req<R>(method: string, path: string): Promise<R> {
    const res = await fetch(`${this.baseUrl}/api/app-calls${path}`, {
      method,
      headers: { authorization: `Bearer ${this.appKey}` },
    });
    const json = (await res.json()) as Envelope<R>;
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Calls API ${method} ${path} failed (${res.status})`);
    }
    return json.data as R;
  }

  /** One page of call history (filters + pagination). */
  list(params: ListCallsParams = {}): Promise<ListCallsPage> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const s = qs.toString();
    return this.req('GET', s ? `/?${s}` : '/');
  }

  /** One call with its analysis + transcript. 403 unless your app is bound to
   * the call's agent or holds `calls:read:org`. */
  get(sessionId: string): Promise<AppCall> {
    return this.req('GET', `/${encodeURIComponent(sessionId)}`);
  }

  /** Mint a one-time ticket for a LIVE call's event stream; connect a WebSocket
   * to the returned `wsUrl` within 30s. Same visibility rule as `get`. */
  streamTicket(sessionId: string): Promise<{ ticket: string; wsUrl: string }> {
    return this.req('POST', `/${encodeURIComponent(sessionId)}/stream-ticket`);
  }
}

// ── Billing (billing:read) ───────────────────────────────────────────────────

/** The org's wallet as its own Billing page shows it. Amounts are numbers
 * (JSON floats); `currency`/`walletRate`/`walletNative` are null for postpaid
 * orgs (their balance is USD-accounted). */
export interface AppWallet {
  mode: 'prepaid' | 'postpaid';
  suspended: boolean;
  balanceUsd: number | null;
  currency: string | null;
  walletRate: number | null;
  walletNative: number | null;
}

/** One settled charge. All money fields are the org's PRICE in USD — the
 * platform's provider cost is never exposed. Decimal-string encoded. */
export interface AppCharge {
  sessionId: string;
  agentId?: string | null;
  agentName?: string | null;
  callType: string;
  startTime?: string | null;
  llmUsd: string;
  sttUsd: string;
  ttsUsd: string;
  telephonyUsd: string;
  platformAiUsd: string;
  postCallAnalysisUsd: string;
  simulationUsd: string;
  embeddingUsd: string;
  platformFeeUsd: string;
  featureSurchargeUsd: string;
  totalChargeUsd: string;
  hasEstimates: boolean;
  /** billedMinutes/feePercent/durationSecs…; `events[]` only when requested. */
  breakdown: Record<string, unknown>;
  ratedAt: string;
}

export interface ListChargesParams {
  agentId?: string;
  callType?: string;
  /** RFC3339 window on settlement time (ratedAt). */
  from?: string;
  to?: string;
  /** Keep each charge's per-event breakdown (heavier pages). */
  includeEvents?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListChargesPage {
  charges: AppCharge[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Client for the billing API (`/api/app-billing`) — needs `billing:read`.
 * The FinOps surface: pull wallet balance + settled charges; pair with the
 * `charge.settled` webhook event for the push side (its payload includes
 * `walletBalanceUsd`, so a `when` predicate makes a zero-code budget alert).
 */
export class BillingClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly appKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async req<R>(path: string): Promise<R> {
    const res = await fetch(`${this.baseUrl}/api/app-billing${path}`, {
      headers: { authorization: `Bearer ${this.appKey}` },
    });
    const json = (await res.json()) as Envelope<R>;
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Billing API GET ${path} failed (${res.status})`);
    }
    return json.data as R;
  }

  /** The org's wallet (null if no billing account exists yet). */
  wallet(): Promise<AppWallet | null> {
    return this.req('/wallet');
  }

  /** One page of settled charges, newest settlement first. */
  charges(params: ListChargesParams = {}): Promise<ListChargesPage> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const s = qs.toString();
    return this.req(s ? `/charges?${s}` : '/charges');
  }

  /** One session's charge with its full (price-only) event breakdown; null
   * while the session is still unsettled (~2-3 min after hangup). */
  charge(sessionId: string): Promise<AppCharge | null> {
    return this.req(`/charges/${encodeURIComponent(sessionId)}`);
  }
}

// ── Knowledge bases (kb:read / kb:write) ─────────────────────────────────────

export interface AppKb {
  id: string;
  /** Your stable per-app key (creates are idempotent on it). */
  key: string | null;
  name: string;
  description?: string | null;
  embeddingModel: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Document metadata — never the body (you pushed it; the platform returns a
 * sha256 `contentHash` so your sync loop can diff without refetching). */
export interface AppKbDocument {
  id: string;
  kbId: string;
  title: string;
  sourceType: string;
  status: 'pending' | 'embedded' | 'failed' | 'indexed';
  error?: string | null;
  contentBytes: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Client for the runtime knowledge-base API (`/api/app-kb`) — the KB-sync
 * surface (Notion/Confluence/Drive → agent KB). Your app sees only its OWN
 * KBs (manifest-bundled ones included). Embedding is async: poll `documents()`
 * until status flips pending → embedded (or failed).
 *
 *   const kb = new KbClient('https://api.telenow.ai', process.env.TELENOW_APP_KEY!);
 *   const faq = await kb.create({ key: 'faq', name: 'Product FAQ' });
 *   const doc = await kb.addDocument(faq.id, { title: 'Pricing', body: text });
 *   // later, when the source page changes (compare contentHash first):
 *   await kb.replaceDocument(faq.id, doc.id, { body: newText }); // returns a NEW doc id
 */
export class KbClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly appKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async req<R>(method: string, path: string, body?: unknown): Promise<R> {
    const res = await fetch(`${this.baseUrl}/api/app-kb${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.appKey}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as Envelope<R>;
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `KB API ${method} ${path} failed (${res.status})`);
    }
    return json.data as R;
  }

  /** Your app's knowledge bases. */
  list(): Promise<{ knowledgeBases: AppKb[] }> {
    return this.req('GET', '/');
  }

  /** Create a KB — idempotent on `key` (re-POSTing returns the existing one). */
  create(input: { key: string; name: string; description?: string }): Promise<AppKb> {
    return this.req('POST', '/', input);
  }

  get(kbId: string): Promise<AppKb> {
    return this.req('GET', `/${encodeURIComponent(kbId)}`);
  }

  remove(kbId: string): Promise<void> {
    return this.req('DELETE', `/${encodeURIComponent(kbId)}`);
  }

  /** Document metadata (status + contentHash for sync diffing). */
  documents(kbId: string): Promise<{ documents: AppKbDocument[] }> {
    return this.req('GET', `/${encodeURIComponent(kbId)}/documents`);
  }

  /** Add a text document (≤ 1 MiB); embedding runs async. */
  addDocument(kbId: string, doc: { title: string; body: string }): Promise<AppKbDocument> {
    return this.req('POST', `/${encodeURIComponent(kbId)}/documents`, doc);
  }

  /** Replace a document's content — old chunks purge, body re-embeds, and the
   * response carries a NEW document id (key on your own source ids). */
  replaceDocument(
    kbId: string,
    docId: string,
    doc: { title?: string; body: string },
  ): Promise<AppKbDocument> {
    return this.req(
      'PUT',
      `/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
      doc,
    );
  }

  removeDocument(kbId: string, docId: string): Promise<void> {
    return this.req(
      'DELETE',
      `/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
    );
  }

  /** Semantic search over this KB — returns the top chunks, relevance-ranked.
   *  For grounding an app mid-task (e.g. a coaching app pulling playbook snippets
   *  for the current call). Only your app's own KBs are searchable. */
  search(kbId: string, input: { query: string; topK?: number }): Promise<{ results: AppKbChunk[] }> {
    return this.req('POST', `/${encodeURIComponent(kbId)}/search`, input);
  }

  /** Agents currently answering from this KB. */
  attachments(kbId: string): Promise<{ agents: { agentId: string; agentName: string }[] }> {
    return this.req('GET', `/${encodeURIComponent(kbId)}/attachments`);
  }

  /** Attach to an agent your app is BOUND to (app-created agents are auto-bound). */
  attach(kbId: string, agentId: string): Promise<void> {
    return this.req('POST', `/${encodeURIComponent(kbId)}/attach`, { agentId });
  }

  detach(kbId: string, agentId: string): Promise<void> {
    return this.req(
      'DELETE',
      `/${encodeURIComponent(kbId)}/attach/${encodeURIComponent(agentId)}`,
    );
  }
}

// ── App AI Gateway (ai:llm / ai:tts / ai:stt) ────────────────────────────────

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** true when the provider didn't report usage and tokens were estimated. */
  estimated: boolean;
}

export interface AiLlmRequest {
  messages: AiChatMessage[];
  /** Coarse tier: 'fast' | 'balanced' | 'smart' (default 'balanced'). Ignored
   *  when an explicit provider+model is given. */
  tier?: 'fast' | 'balanced' | 'smart';
  /** Explicit catalog model — both required, and the pair must be catalogued. */
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** The live call this AI spend attaches to (required — billing is per-call). */
  sessionId: string;
  /** BYOK: your own provider key ⇒ the org is NOT charged for this call (you bill
   *  it through your own app pricing instead). */
  apiKey?: string;
}

export interface AiLlmResponse {
  text: string;
  provider: string;
  model: string;
  byok: boolean;
  usage: AiUsage;
}

export interface AiTtsRequest {
  text: string;
  voice: string;
  /** TTS provider (default 'elevenlabs'); needs a platform key unless BYOK. */
  provider?: string;
  model?: string;
  sessionId: string;
  apiKey?: string;
}

export interface AiTtsResponse {
  /** Base64 audio. Usually μ-law 8 kHz (see `format`) — the runtime's telephony
   *  format; decode accordingly. */
  audioBase64: string;
  format: string;
  sampleRate: number;
  channels: number;
  provider: string;
  voice: string;
  byok: boolean;
  chars: number;
}

/**
 * Client for the App AI Gateway (`/api/app-ai`) — invoke the platform's LLM and
 * TTS engines with the org's catalog models, BILLED TO THE ORG WALLET (unless
 * you pass your own `apiKey`, BYOK). Every call attaches to one of your calls
 * via `sessionId`, so the spend lands on that call's bill.
 *
 *   const ai = new AiClient('https://api.telenow.ai', process.env.TELENOW_APP_KEY!);
 *   const { text } = await ai.llm({
 *     tier: 'fast',
 *     sessionId,
 *     messages: [{ role: 'user', content: 'Summarise the call so far.' }],
 *   });
 */
export class AiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly appKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async req<R>(method: string, path: string, body?: unknown): Promise<R> {
    const res = await fetch(`${this.baseUrl}/api/app-ai${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.appKey}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as Envelope<R>;
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `AI API ${method} ${path} failed (${res.status})`);
    }
    return json.data as R;
  }

  /** Chat completion on a platform (or BYOK) model. */
  llm(request: AiLlmRequest): Promise<AiLlmResponse> {
    return this.req('POST', '/llm', request);
  }

  /** Streaming chat completion (SSE). Calls `onToken` per token; resolves to the
   *  full text + usage when the stream ends. Billed identically to `llm`. */
  async llmStream(
    request: AiLlmRequest,
    onToken: (token: string) => void,
  ): Promise<{ text: string; usage: AiUsage }> {
    const res = await fetch(`${this.baseUrl}/api/app-ai/llm/stream`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.appKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok || !res.body) throw new Error(`AI stream failed (${res.status})`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let acc = '';
    let usage: AiUsage = { inputTokens: 0, outputTokens: 0, estimated: true };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const payload = raw
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!payload) continue;
        let frame: { token?: string; done?: boolean; usage?: AiUsage; error?: string };
        try {
          frame = JSON.parse(payload);
        } catch {
          continue;
        }
        if (frame.error) throw new Error(frame.error);
        if (frame.done) usage = frame.usage ?? usage;
        else if (typeof frame.token === 'string') {
          acc += frame.token;
          onToken(frame.token);
        }
      }
    }
    return { text: acc, usage };
  }

  /** Text-to-speech; returns base64 audio (usually μ-law 8 kHz). */
  tts(request: AiTtsRequest): Promise<AiTtsResponse> {
    return this.req('POST', '/tts', request);
  }

  /** Available model tiers + the org's catalog (for building a model picker). */
  models(): Promise<{ tiers: { llm: string[] }; catalog: unknown }> {
    return this.req('GET', '/models');
  }
}

// ── KB search result chunk ───────────────────────────────────────────────────

export interface AppKbChunk {
  chunkId: string;
  docId: string;
  seq: number;
  text: string;
}

// ── Members roster (members:read) ────────────────────────────────────────────

export interface AppMember {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  /** Only present when the app also holds `user:profile` (PII gate). */
  email?: string;
}

/**
 * Client for the org member roster (`/api/app-members`) — for apps that manage
 * per-user config (e.g. a coaching app's admin page that enables coaching and
 * maps a knowledge base per user). Scoped to the org that installed the app.
 * Email is withheld unless the app also holds `user:profile`.
 *
 *   const members = new MembersClient('https://api.telenow.ai', process.env.TELENOW_APP_KEY!);
 *   const { members: roster } = await members.list();
 */
export class MembersClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly appKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async req<R>(path: string): Promise<R> {
    const res = await fetch(`${this.baseUrl}/api/app-members${path}`, {
      headers: { authorization: `Bearer ${this.appKey}` },
    });
    const json = (await res.json()) as Envelope<R>;
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? `Members API GET ${path} failed (${res.status})`);
    }
    return json.data as R;
  }

  /** The org's members. */
  list(): Promise<{ members: AppMember[]; total: number }> {
    return this.req('/');
  }
}
