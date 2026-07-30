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
  /** telephony | softphone | web_call | whatsapp | web_chat | simulation */
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
  label?: string;
  phone?: string | null;
  /** Which plane this channel sends on — BRANCH ON THIS.
   *  'cloud' = Meta Cloud API: outside the 24-hour service window you must send
   *  an approved template, and template management needs `whatsapp:templates`.
   *  'web'   = a WhatsApp Web session: plain text any time, no templates, no
   *  window — but listed only if your app holds `whatsapp:web`. */
  kind?: 'web' | 'cloud';
  [k: string]: unknown;
}

/** The public exposure of an agent your app owns. */
export interface TelenowAgentPublicLink {
  /** Whether the agent is currently reachable on its public link. */
  isPublic: boolean;
  /** Stable share slug. This is what `links.mint({ action: 'agent_call' })`
   *  expects in `context.slug`. */
  slug: string;
  /** The `/p/:slug` share page. */
  publicUrl: string;
  /** One-line `<script>` tag that embeds the agent on any site. */
  embedSnippet: string;
}

export interface TelenowAgents {
  /** List the org's agents (id + name) — needs the `agents:read` scope. */
  list(): Promise<TelenowAgentSummary[]>;
  /** Build a real voice agent from one of THIS app's bundled agent templates
   *  (declared in `manifest.agents`). The new agent is auto-bound to your app's
   *  tools. Needs `agents:read` + an owner/admin user.
   *
   *  By default this then opens the agent builder — which navigates away and
   *  UNMOUNTS your page, cancelling anything you were about to do next. Pass
   *  `{ open: false }` when the create is the first step of a longer setup
   *  (publish it, save its id into settings) so your page stays alive. */
  createFromTemplate(
    templateId: string,
    opts?: { open?: boolean },
  ): Promise<{ agentId: string; kind: 'single' | 'flow' }>;
  /** Read the public slug + share URL of an agent your app owns (needs
   *  `agents:read`). The slug is materialised on first read and never changes,
   *  so it is safe to read before publishing — the widget just 404s until then.
   *
   *  This is how an app points a link at its own agent: `links.mint` with
   *  `action: 'agent_call'` resolves the call by SLUG, not by agent id. */
  publicLink(agentId: string): Promise<TelenowAgentPublicLink>;
  /** Put an agent your app owns on (or take it off) the open internet. Needs
   *  `agents:write` AND an owner/admin user — exposing an agent is a governance
   *  decision, so it is not something a plain member can click through.
   *  Unpublishing keeps the slug, so re-publishing revives existing links. */
  setPublic(agentId: string, enabled?: boolean): Promise<TelenowAgentPublicLink>;
  /** Build a whole multi-agent TEAM from one of THIS app's team templates
   *  (declared in `manifest.agentTeams`): every member is created, auto-bound to
   *  your tools, and the handoffs are wired. Opens the entry agent in the builder.
   *  Needs `agents:read` + an owner/admin user. */
  createTeamFromTemplate(teamId: string): Promise<{
    teamId: string;
    entryAgentId: string | null;
    agents: { ref: string; agentId: string | null; kind: 'single' | 'flow' }[];
  }>;
  /** Read the FULL configuration of an agent your app is bound to — prompt,
   *  model, voice, STT, behaviour, telephony, and the conversation graph for a
   *  flow agent. Needs `agents:config:read`.
   *
   *  Single-context and flow agents return the SAME shape: `kind` says which you
   *  have and `flow` is null for a single, so `prompt.systemPrompt` is the
   *  agent's instructions either way and an optimiser needs no branch.
   *
   *  Secret-free by construction — BYOK keys are stripped, tools come back as
   *  name/description only, and a node reports `toolCount` instead of tools. */
  getConfig(agentId: string): Promise<TelenowAgentConfig>;
  /** Write settings back. The patch is sparse and grouped exactly like the
   *  `getConfig` result, so the loop is read → edit one group → write.
   *
   *  Each group needs its OWN `agents:config:write:<group>` scope, and the group
   *  is decided by the field: editing a flow node's prompt needs
   *  `…:write:prompt`, not `…:write:flow`. Every group in the patch is
   *  authorized before ANY of it is applied.
   *
   *  Pass `ifUnmodifiedSince: config.updatedAt` to get a conflict instead of
   *  clobbering a dashboard edit made while you were thinking. */
  updateConfig(
    agentId: string,
    patch: TelenowAgentConfigPatch,
  ): Promise<{ updated: string[]; config: TelenowAgentConfig }>;
}

/** One agent's configuration, grouped the way the write scopes divide it. */
export interface TelenowAgentConfig {
  agentId: string;
  name: string;
  description: string | null;
  kind: 'single' | 'flow';
  /** Echo back as `ifUnmodifiedSince` to make the next write conditional. */
  updatedAt: string;
  prompt: { systemPrompt: string | null };
  model: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    config: Record<string, unknown>;
  };
  voice: { provider: string; voice: string; config: Record<string, unknown> };
  stt: { provider: string; config: Record<string, unknown> };
  /** The session config — turn-taking, barge-in, silence handling. */
  behavior: Record<string, unknown>;
  telephony: { provider: string | null; config: Record<string, unknown> };
  /** null for a single-context agent. */
  flow: {
    startNodeId?: string;
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  } | null;
  /** READ-ONLY. No scope lets an app write an agent's tools — a prompt edit
   *  preserves them. */
  tools: { name: string; description: string; kind: string }[];
  realtimeEngine: string | null;
}

/** A sparse settings patch. Omit what you aren't changing; send an explicit
 *  `null` inside a blob to REMOVE that key. */
export type TelenowAgentConfigPatch = Partial<
  Pick<TelenowAgentConfig, 'prompt' | 'model' | 'voice' | 'stt' | 'behavior' | 'telephony'>
> & {
  flow?: {
    /** Sparse merge BY NODE ID — list only the nodes you touch, and within each
     *  only the fields you change. Merging into a node that doesn't exist is an
     *  error, not a silent create. */
    nodes?: ({ id: string } & Record<string, unknown>)[];
    /** New nodes. Kinds that act on the world (`tool`, `code`, `transfer`,
     *  `agent`, `subagent`) are refused — an app cannot conjure side effects. */
    addNodes?: ({ id: string; kind?: string } & Record<string, unknown>)[];
    removeNodeIds?: string[];
    /** Full replace when present. */
    edges?: Record<string, unknown>[];
    startNodeId?: string;
  };
  /** The `updatedAt` you read. Mismatched ⇒ conflict instead of a clobber. */
  ifUnmodifiedSince?: string;
};

/** One person in the installing org's member roster. */
export interface TelenowMember {
  userId: string;
  /** Full name, or `""` when the account has neither first nor last name set. */
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  /** owner | admin | developer | viewer | member */
  role: string;
  /** Only present when the app ALSO declared `user:profile`. */
  email?: string;
}

export interface TelenowMembers {
  /** The org's member roster — needs `members:read` (email additionally needs
   *  `user:profile`). Use it to turn a stored user id into a name: store ids on
   *  your records, resolve them for display. */
  list(): Promise<{ members: TelenowMember[]; total: number }>;
}

export interface TelenowCalls {
  /** Place an outbound AI voice call — needs `calls:initiate`. `variables` fills
   *  the agent's {placeholder} context variables. */
  initiate(
    agentId: string,
    phone: string,
    variables?: Record<string, string>,
  ): Promise<{ sessionId?: string; status?: string }>;
  /** Read the org's call history — needs `calls:read` (or `calls:read:org`). */
  history(filters?: Record<string, string>): Promise<CallRecord[]>;
  /** Open a call's detail page — recording player, transcript, timeline. Needs
   *  `calls:read`.
   *
   *  Link to this rather than copying a recording URL into your own storage: the
   *  recording is a governed asset with its own retention and access rules, and
   *  a second copy of the link outlives them.
   *
   *  **This NAVIGATES**, which unmounts your page — treat it as the last thing
   *  a click does. */
  open(sessionId: string): Promise<{ ok: true }>;
}

export interface TelenowWhatsapp {
  /** List WhatsApp channels — needs `whatsapp:send`. */
  channels(): Promise<WhatsappChannel[]>;
  /** Send a WhatsApp message from a channel to a number — needs `whatsapp:send`.
   *  Works on a 'web' channel any time; on a 'cloud' channel only inside the
   *  24-hour service window. Outside it, use `sendTemplate`. */
  send(channelId: string, to: string, message: string): Promise<{ ok: true }>;
  /** Send an APPROVED template — the only way to reach someone on a 'cloud'
   *  channel outside the 24-hour window.
   *
   *  ★ `urlSuffix` is the dynamic part of a URL button (the token, the path).
   *  Put it HERE, never in `variables`: it is a button parameter, and a template
   *  sent with it in the body produces a message that looks perfect but whose
   *  button points at the bare base URL — so it only fails when the recipient
   *  taps it. The host assembles the button component for you. */
  sendTemplate(
    channelId: string,
    to: string,
    opts: { template: string; language?: string; variables?: string[]; urlSuffix?: string },
  ): Promise<unknown>;
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

/** One message in an LLM request. */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** An LLM completion request. Give either `tier` OR `provider`+`model`. */
export interface AiLlmRequest {
  /** Attach the spend to this call. OMIT for work that isn't tied to a call —
   *  summarising an upload, precomputing at record-creation time — and it meters
   *  to the org with no session. */
  sessionId?: string;
  /** Coarse model tier: 'fast' | 'balanced' | 'smart'. Ignored if provider+model set. */
  tier?: 'fast' | 'balanced' | 'smart';
  provider?: string;
  model?: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiLlmResult {
  text: string;
  provider: string;
  model: string;
  usage?: unknown;
}

/** Platform AI gateway, billed to the org wallet. Needs the `ai:llm` scope. */
export interface TelenowAi {
  llm(request: AiLlmRequest): Promise<AiLlmResult>;
  /** Same as `llm` but `onToken` fires per token; resolves when the stream ends. */
  llmStream(request: AiLlmRequest, onToken?: (token: string) => void): Promise<AiLlmResult>;
  /** Coarse tiers + the org's model catalog, for setup UIs. Any `ai:*` scope. */
  models(): Promise<unknown>;
}

/** What opening a public link does. */
export type AppLinkAction = 'agent_call' | 'form' | 'page';

export interface MintLinkRequest {
  action: AppLinkAction;
  /** Payload the RESOLVE hands back. Captured now, server-side — the recipient's
   *  browser can never supply or alter it. Keep it small and free of secrets: it
   *  is returned to an unauthenticated page. */
  context?: Record<string, unknown>;
  /** Your own row this link is about, so you can find it again without an index. */
  targetType?: string;
  targetId?: string;
  /** Lifetime. `expiresAt` wins if both are given; default depends on `opensAt`. */
  ttlSecs?: number;
  expiresAt?: string;
  /** Not valid before this instant — for a link tied to a scheduled slot. */
  opensAt?: string;
  /** Defaults true. */
  singleUse?: boolean;
  /** Second factor. Send it on a DIFFERENT channel from the link, or it adds
   *  nothing. Stored hashed and never returned. */
  code?: string;
}

export interface MintedLink {
  id: string;
  /** Returned ONCE — not stored in plaintext and not readable back. */
  token: string;
  url: string;
  expiresAt: string;
  singleUse: boolean;
  requiresCode: boolean;
}

export interface AppLinkSummary {
  id: string;
  action: AppLinkAction;
  targetType: string | null;
  targetId: string | null;
  expiresAt: string;
  opensAt: string | null;
  singleUse: boolean;
  usedAt: string | null;
  revokedAt: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  createdAt: string;
  requiresCode: boolean;
}

/** Per-recipient public links: give one named person a secure, expiring URL that
 *  does one thing, with no account. Needs `links:write` / `links:read`. */
export interface TelenowLinks {
  mint(request: MintLinkRequest): Promise<MintedLink>;
  /** Status of your links — opened, used, revoked. Never returns tokens. */
  list(query?: {
    targetType?: string;
    targetId?: string;
    status?: 'active' | 'used' | 'expired' | 'revoked';
    limit?: number;
  }): Promise<{ links: AppLinkSummary[] }>;
  revoke(linkId: string): Promise<{ revoked: boolean }>;
}

export interface TelenowStream {
  /** Subscribe to a LIVE call's event stream (lifecycle + partial transcript).
   *  Resolves to an unsubscribe function. Needs the `calls:read` scope (or
   *  `calls:read:org` for org-wide analytics apps). The host holds the
   *  WebSocket and relays frames — your iframe never opens a socket. */
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
  /** Plain text out of a stored document — .pdf, .docx, .txt, .md. Saves you
   *  bundling a parser into the browser. Needs `files:read`.
   *
   *  `truncated` is true when the document was longer than the AI gateway's
   *  input limit and the text was cut to fit; the point of this call is to feed
   *  `ai.llm`, so it never returns more than that can accept.
   *
   *  Throws on csv/json/xlsx (those hold rows — read the blob and parse it), and
   *  on a document with no extractable text, which usually means a scanned or
   *  image-only PDF. */
  extract(path: string): Promise<{ text: string; chars: number; truncated: boolean }>;
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
  /** Save non-secret config from your app's own Setup page. Owner/admin only.
   *
   *  NOTE: `all()`/`get()` read a STATIC snapshot injected when the page loaded,
   *  so they do NOT reflect a write until the page reloads. Hold your own state
   *  after calling this rather than reading it straight back. Secrets are not
   *  writable here — those stay in the admin settings form. */
  set(values: Record<string, unknown>): Promise<{ ok: true }>;
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

/** Fill the platform's OWN campaigns from your source (a sheet, a CRM), rather
 *  than creating a parallel app-owned one — the targets land in the normal target
 *  table and the normal engine dials them with the campaign's own concurrency,
 *  calling window, retry policy and Do-Not-Call list. Needs `campaigns:write`. */
export interface TelenowCampaigns {
  /** Add targets to an EXISTING campaign, as the signed-in user.
   *
   *  At most **1000** per call — the batch crosses postMessage as one frame and
   *  then one HTTP body, so importing a large list means paging. `suppressed`
   *  counts numbers dropped for the org's Do-Not-Call list.
   *
   *  Refreshes the host's campaign views itself, so you don't have to. */
  addTargets(
    campaignId: string,
    targets: { phoneNumber: string; variables?: Record<string, string> }[],
  ): Promise<{ added: number; suppressed?: number }>;
  get(campaignId: string): Promise<Record<string, unknown>>;
  /** The org's campaigns, slim — enough to render a picker so a user can BIND a
   *  source to a campaign once instead of re-choosing it on every import. */
  list(): Promise<{ id: string; name: string; status: string }[]>;
}

/** Call a connected integration by CAPABILITY — the platform resolves which of
 *  the org's connections serves it and injects the credential server-side.
 *
 *  Prefer this over `http()` for anything a connector already covers: your app
 *  never holds an OAuth token, never needs the vendor's API, and it keeps working
 *  across provider variants (the unified `google` connector and the older
 *  `google_sheets` one both serve `sheets.*`, but only one is reachable through
 *  the HTTP proxy). Needs the `connection:<provider>` scope. */
export interface TelenowConnector {
  /** Connections that can serve a capability, each named by the ACCOUNT that
   *  authorised it. An org may hold several Google accounts, and a document
   *  shared with one is invisible to the others — so an app reading a sheet
   *  should show, or ask, which identity it uses. Pass the chosen `id` as
   *  `opts.connectionId` to `invoke`. */
  connections(capability: string): Promise<{
    connections: {
      id: string;
      provider: string;
      label: string;
      status: string;
      account?: string | null;
    }[];
  }>;
  invoke<T = unknown>(
    capability: string,
    args?: Record<string, unknown>,
    opts?: {
      /** The action's bind settings — which spreadsheet/tab, which pipeline. */
      binding?: Record<string, unknown>;
      /** Narrow resolution when several connections could serve the capability. */
      provider?: string;
      /** Pin an exact connection (from `connections()`), so repeated runs always
       *  read as the same account instead of whichever resolution happens to pick. */
      connectionId?: string;
    },
  ): Promise<{ result: T }>;
}

/** Host UI services. Your panel is a guest in someone else's screen; these let it
 *  use the HOST's modal, toasts and data freshness instead of drawing its own
 *  inside a box — which is the difference between a feature and an embed. */
export interface TelenowUi {
  /** Re-host one of YOUR pages as a modal over the dashboard. A slot panel is too
   *  cramped for real work (a column mapper); this is the escalation. */
  openModal(
    pageId: string,
    context?: Record<string, unknown>,
    opts?: { size?: 'sm' | 'md' | 'lg' },
  ): Promise<{ ok: true }>;
  closeModal(): Promise<{ ok: true }>;
  /** Tell the host that data it is showing has changed, so its tables re-read.
   *  Without this the user acts in your panel and watches a stale table — the
   *  clearest tell that a panel is bolted on. */
  refresh(
    what: 'campaigns' | 'campaign' | 'campaign-targets' | 'calls' | 'agents',
  ): Promise<{ ok: true }>;
  toast(message: string, level?: 'success' | 'warning' | 'error'): Promise<{ ok: true }>;
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
  /** Fill the platform's own campaigns (needs campaigns:write). */
  campaigns: TelenowCampaigns;
  /** Connected integrations, by capability (needs connection:<provider>). */
  connector: TelenowConnector;
  /** Host modal / toast / data-refresh. */
  ui: TelenowUi;
  session: TelenowSession;
  /** Live call event stream (lifecycle + partial transcript; needs calls:read). */
  stream: TelenowStream;
  /** Per-app private blob storage (needs files:read / files:write). */
  files: TelenowFiles;
  /** Platform AI gateway (needs ai:llm). */
  ai: TelenowAi;
  /** Per-recipient public links (needs links:write / links:read). */
  links: TelenowLinks;
  /** The installing org's member roster (needs members:read). */
  members: TelenowMembers;
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
  /** The org's member roster surfaced via `telenow.members.list()`. */
  members?: TelenowMember[];
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
  // In-memory public links (not persisted). Holds the token so `mint` can return
  // a URL a dev can actually paste, but `list` strips it — mirroring the real API,
  // which never hands a token back after minting.
  const mockLinks = new Map<string, AppLinkSummary & { token: string; url: string }>();
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
      async set(values: Record<string, unknown>) {
        note('settings.set', values);
        // Mutate the fixture so a dev sees the write take effect, matching the
        // real bridge (which also patches its snapshot after a successful save).
        Object.assign((opts.settings ??= {}), values);
        return { ok: true as const };
      },
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
      async createFromTemplate(templateId, opts) {
        note('agents.createFromTemplate', { templateId, open: opts?.open !== false });
        return { agentId: mockId(), kind: 'single' as const };
      },
      async publicLink(agentId) {
        note('agents.publicLink', { agentId });
        // A plausible slug, so a dev-mode mint + `/l/<token>` round-trip looks
        // like the real thing rather than resolving to an empty slug.
        const slug = `mock-agent-${agentId.slice(0, 8)}`;
        return {
          isPublic: false,
          slug,
          publicUrl: `https://telenow.ai/p/${slug}`,
          embedSnippet: `<script src="https://api.telenow.ai/widget.js" data-slug="${slug}"></script>`,
        };
      },
      async setPublic(agentId, enabled) {
        note('agents.setPublic', { agentId, enabled: enabled !== false });
        const slug = `mock-agent-${agentId.slice(0, 8)}`;
        return {
          isPublic: enabled !== false,
          slug,
          publicUrl: `https://telenow.ai/p/${slug}`,
          embedSnippet: `<script src="https://api.telenow.ai/widget.js" data-slug="${slug}"></script>`,
        };
      },
      async getConfig(agentId) {
        note('agents.getConfig', { agentId });
        // A FLOW fixture on purpose: the single-context shape is this one minus
        // `flow`, so a dev who builds against the mock handles both. `tools` is
        // populated so an optimiser is written against an agent that HAS tools
        // it must keep describing — and cannot rewrite.
        return {
          agentId,
          name: 'Front Desk (mock)',
          description: null,
          kind: 'flow' as const,
          updatedAt: new Date().toISOString(),
          prompt: { systemPrompt: 'You are the receptionist for Acme Clinic (mock).' },
          model: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7, config: { temperature: 0.7 } },
          voice: { provider: 'elevenlabs', voice: 'rachel', config: {} },
          stt: { provider: 'deepgram', config: {} },
          behavior: { bargeIn: true, silenceSecs: 8 },
          telephony: { provider: null, config: { agentMsg: 'Thanks for calling Acme Clinic!' } },
          flow: {
            startNodeId: 'greeting',
            nodes: [
              { id: 'greeting', kind: 'conversation', name: 'Greeting', prompt: 'Greet the caller.', toolCount: 0, precallLookupCount: 0 },
              { id: 'booking', kind: 'conversation', name: 'Booking', prompt: 'Book a slot.', toolCount: 1, precallLookupCount: 0 },
            ],
            edges: [{ source: 'greeting', target: 'booking', condition: { kind: 'ai', prompt: 'wants an appointment' } }],
          },
          tools: [{ name: 'book_appointment', description: 'Book a slot', kind: 'app' }],
          realtimeEngine: null,
        };
      },
      async updateConfig(agentId, patch) {
        const updated = Object.keys(patch).filter((k) => k !== 'ifUnmodifiedSince');
        note('agents.updateConfig', { agentId, updated });
        return { updated, config: await this.getConfig(agentId) };
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
      async open(sessionId) {
        // No-op in dev: there is no dashboard to navigate to, and silently
        // "succeeding" is right — the log line is how you check you wired it up.
        note('calls.open', { sessionId });
        return { ok: true as const };
      },
    },
    whatsapp: {
      async channels() {
        note('whatsapp.channels');
        // Both kinds on purpose: an app that only ever sees one in dev will ship
        // an untested branch for the other.
        return [
          { id: mockId(), label: 'Business number', phone: '+919876500000', kind: 'cloud' as const },
          { id: mockId(), label: 'Team WhatsApp', phone: '+919876500001', kind: 'web' as const },
        ];
      },
      async send(channelId, to, message) {
        note('whatsapp.send', { channelId, to, chars: message.length });
        return { ok: true as const };
      },
      async sendTemplate(channelId, to, opts) {
        note('whatsapp.sendTemplate', {
          channelId, to, template: opts.template,
          vars: opts.variables?.length ?? 0,
          hasUrlSuffix: Boolean(opts.urlSuffix),
        });
        return { ok: true as const };
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
    links: {
      async mint(request) {
        note('links.mint', { action: request.action, targetId: request.targetId });
        const id = mockId();
        const token = `devtoken_${id.replace(/-/g, '').slice(0, 24)}`;
        const ttl = request.ttlSecs ?? 7 * 24 * 3600;
        const link = {
          id,
          token,
          // Points at the real route so a dev can paste it and see the page.
          url: `${typeof location !== 'undefined' ? location.origin : ''}/l/${token}`,
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
          singleUse: request.singleUse ?? true,
          requiresCode: Boolean(request.code),
        };
        mockLinks.set(id, {
          ...link,
          action: request.action,
          targetType: request.targetType ?? null,
          targetId: request.targetId ?? null,
          opensAt: request.opensAt ?? null,
          usedAt: null,
          revokedAt: null,
          openCount: 0,
          lastOpenedAt: null,
          createdAt: new Date().toISOString(),
        });
        return link;
      },
      async list(query) {
        note('links.list', query as Record<string, unknown> | undefined);
        let rows = [...mockLinks.values()];
        if (query?.targetType) rows = rows.filter((r) => r.targetType === query.targetType);
        if (query?.targetId) rows = rows.filter((r) => r.targetId === query.targetId);
        if (query?.status === 'used') rows = rows.filter((r) => r.usedAt);
        if (query?.status === 'revoked') rows = rows.filter((r) => r.revokedAt);
        if (query?.status === 'active') rows = rows.filter((r) => !r.usedAt && !r.revokedAt);
        // The real API never returns tokens on list — mirror that, or an app
        // will work in dev and break the moment it runs for real.
        const links = rows.map(({ token: _token, ...rest }) => rest) as unknown as AppLinkSummary[];
        return { links };
      },
      async revoke(linkId) {
        note('links.revoke', { linkId });
        const row = mockLinks.get(linkId);
        if (!row) throw new Error('link not found');
        row.revokedAt = row.revokedAt ?? new Date().toISOString();
        return { revoked: true };
      },
    },
    members: {
      async list() {
        note('members.list');
        // More than one, and one with an EMPTY name: the real roster returns ""
        // when an account has no first or last name set, and an app that only
        // ever sees populated names ships a UI that renders a blank cell.
        const members = opts.members ?? [
          { userId: opts.user?.id ?? mockId(), name: 'You (mock)', role: opts.user?.role ?? 'owner' },
          { userId: mockId(), name: 'Priya Recruiter', role: 'member' },
          { userId: mockId(), name: '', role: 'member' },
        ];
        return { members, total: members.length };
      },
    },
    ai: {
      async llm(request) {
        note('ai.llm', { messages: request.messages?.length, tier: request.tier });
        // Echo the last user message back so a dev can see their prompt reached
        // the call, rather than a canned string that hides a wiring mistake.
        const last = [...(request.messages ?? [])].reverse().find((m) => m.role === 'user');
        return {
          text: `[telenow dev mock] no model was called. Last user message was:\n\n${last?.content ?? '(none)'}`,
          provider: 'mock',
          model: request.model ?? request.tier ?? 'balanced',
        };
      },
      async llmStream(request, onToken) {
        note('ai.llmStream', { messages: request.messages?.length });
        const res = await this.llm(request);
        if (onToken) for (const tok of res.text.split(' ')) onToken(tok + ' ');
        return res;
      },
      async models() {
        note('ai.models');
        return { tiers: ['fast', 'balanced', 'smart'], models: [] };
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
      async extract(path) {
        note('files.extract', { path });
        const f = mockFiles.get(path);
        if (!f) throw new Error('file not found');
        // The real endpoint parses pdf/docx server-side; the mock can only decode
        // what is already text. Handle Blob/File explicitly — `files.put` is
        // usually fed a File straight off an <input type=file>, and treating that
        // as "not text" would silently return "" and look like a parse that
        // succeeded on an empty document.
        let text: string;
        if (typeof f.body === 'string') text = f.body;
        else if (f.body instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(f.body));
        else text = await (f.body as Blob).text();
        if (!text.trim()) {
          throw new Error(
            'no extractable text (the real endpoint throws the same for a scanned/image-only PDF)',
          );
        }
        return { text, chars: text.length, truncated: false };
      },
    },
    // Campaign targets are REAL platform rows, and a connector call reaches a real
    // third-party account — neither has a meaningful in-memory stand-in, and a
    // fake success here would be worse than an error: an importer would look like
    // it worked and add nothing. `telenow dev` refuses; use live preview.
    campaigns: {
      addTargets() {
        return unavailable('campaigns.addTargets');
      },
      get() {
        return unavailable('campaigns.get');
      },
      list() {
        return unavailable('campaigns.list');
      },
    },
    connector: {
      connections() {
        return unavailable('connector.connections');
      },
      invoke() {
        return unavailable('connector.invoke');
      },
    },
    // The UI services DO have honest stand-ins: they are host chrome, so the mock
    // logs them and resolves, letting a dev exercise the real code path (open the
    // mapper, flush, toast, close) without a dashboard.
    ui: {
      async openModal(pageId: string, ctx?: Record<string, unknown>, o?: { size?: string }) {
        note('ui.openModal', { pageId, context: ctx, size: o?.size });
        return { ok: true as const };
      },
      async closeModal() {
        note('ui.closeModal', {});
        return { ok: true as const };
      },
      async refresh(what: string) {
        note('ui.refresh', { what });
        return { ok: true as const };
      },
      async toast(message: string, level?: string) {
        note('ui.toast', { message, level });
        return { ok: true as const };
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
