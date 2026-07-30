# Changelog

## 0.6.0

<!-- ───────────────────────────────────────────────────────────────────────────
DRAFT — the block below was reconstructed from uncommitted diffs by someone who
did NOT write that code. Every line needs a nod from whoever did before this is
published; the wording is a starting point, not a record. Delete this comment
once reviewed.
──────────────────────────────────────────────────────────────────────────── -->

### Agent configuration
- **`telenow.agents.getConfig(agentId)`** — read a bound agent's full setup:
  prompt, model, voice, STT, behaviour, telephony and the flow graph. Secret-free
  (BYOK keys stripped, tools reduced to name/description). Needs
  `agents:config:read`.
- **`telenow.agents.updateConfig(agentId, patch)`** — write settings back. Gated
  **per setting group** (`prompt` · `model` · `voice` · `stt` · `behavior` ·
  `flow` · `telephony` · `analysis`), so an improver app asks only for what it
  changes. The group is decided by the FIELD, not the section it appears in.

### Agent sharing
- **`telenow.agents.publicLink(agentId)`** — the agent's public slug, share URL and
  embed snippet (`agents:read`).
- **`telenow.agents.setPublic(agentId, enabled)`** — put an agent on, or take it
  off, the open internet. Owner/admin only (`agents:write`).
- `useAgents()` gains `createFromTemplate`, `createTeamFromTemplate`, `publicLink`
  and `setPublic`; `createFromTemplate` accepts `{ open: false }` to stay on the
  app's page instead of navigating to the builder.

### Calls
- **`telenow.calls.open(sessionId)`** / `useCall().open` — send the user to the
  call's own detail page (recording, transcript, timeline) rather than re-hosting
  any of it. `useCall().open` checks the METHOD, not just the namespace, so it
  degrades cleanly on an older dashboard.
- **`telenow.calls.arm(sessionId, opts)`** — arm live assistance on a call in
  progress.

### Platform AI gateway
- **`telenow.ai.llm(request)`** and **`ai.llmStream(request, onToken)`** — the
  platform LLM, **billed to the installing org's wallet**. `sessionId` is optional:
  pass it to attach spend to a call, omit it for work not tied to one.
- **`telenow.ai.models()`** — coarse tiers plus the org's model catalog, for
  setup UIs. Any `ai:*` scope.

### Per-recipient public links
- **`telenow.links.mint / list / revoke`** — give one named person a secure,
  expiring URL that does exactly one thing, with no account. `list` **never**
  returns tokens; the token exists only in the response to `mint`.

### Knowledge base, files, members
- **`telenow.kb.search(kbId, request)` / `kb.list()`** — query the runtime KB.
- **`telenow.files.extractText(path)`** — plain text out of a stored `.pdf` /
  `.docx` / `.txt` / `.md` (`files:read`).
- **`telenow.members.list()`** — the org's member roster (id, name, email, role).
  Needs `members:read`.

### CLI (`telenow build` / `validate`)
- Validates the newer scopes: the `agents:config:*` group scopes (listed
  individually so a typo'd group is caught rather than silently refused at
  runtime), `whatsapp` / `whatsapp:templates` / `whatsapp:campaign` /
  `whatsapp:web`, and `links:read` / `links:write`.
- Knows the native-WhatsApp event topics (`whatsapp.message.received`,
  `whatsapp.message.status`, `whatsapp.account.health`).
- Documents the **two scope planes** in-source: the UI bridge (`whatsapp:send`)
  and the app-key REST surface (`whatsapp`). An app that sends from a page AND
  from its backend needs both — declaring one silently fails on the other plane.

<!-- ── end DRAFT ─────────────────────────────────────────────────────────── -->

### App UI & connectors
- **`telenow.connector.connections(capability)`** — the org's connections that can
  serve a capability, each named by the **account** that authorised it. An org may
  hold several Google accounts, and a document shared with one is invisible to the
  others, so an app that reads a sheet should show — or ask — which identity it
  uses. `invoke` now takes `opts.connectionId` to pin one, so repeated syncs always
  read as the same account instead of whichever resolution happens to choose.
- **`telenow.campaigns.list()`** — the org's campaigns (id, name, status), enough to
  render a picker so a user can bind a source to a campaign once instead of
  re-choosing it on every import.
- **`binding` may be written flat.** `{ spreadsheet_id, sheet_name }` now works
  alongside the nested `{ settings: { … } }` shape an agent tool stores. The flat
  form previously overlaid nothing and produced "choose its target in the agent
  builder" — advice an app user cannot act on.
- **Only `list_action` is rendered.** `column`, `row_action` and `bulk_action`
  validate and install but draw nothing yet; publish preflight now warns
  (`CONTRIBUTION_UNRENDERED`) rather than letting them fail silently.
- `telenow dev`: `connector.connections` refuses like the rest of the connector
  surface — a fake account list would be worse than an error.

## 0.5.0
- **`ui.contributions` — UI the platform renders for you.** A slot embeds *your*
  page in an iframe; a **contribution** describes what you want and the dashboard
  draws it with its **own** components. That reaches places an iframe structurally
  cannot — a button in the host's list toolbar, a column in its table, an item in
  its row menu — and because there is no foreign document there is nothing to
  style-match and no theme to keep in sync. Kinds: `list_action`, `column`,
  `row_action`, `bulk_action`. Surfaces: `campaign_targets`, `campaigns_list`,
  `calls_list`, `agents_list`. Use a contribution for the entry point and a page
  (`modal: true`) for the work itself.
- **New slot `campaign_targets_panel`** — beside a campaign's target importer
  (context: `campaignId`, `agentId`).
- **`telenow.connector.invoke(capability, args, { binding })`** — call a connected
  integration by CAPABILITY. The platform resolves which of the org's connections
  serves it and injects the credential server-side, so your app never holds an
  OAuth token and never needs the vendor's API. Prefer it over `http()` for
  anything a connector covers: it also keeps working across provider variants
  (the unified `google` connector and the older `google_sheets` one both serve
  `sheets.*`, but only one is reachable through the HTTP proxy). Needs
  `connection:<provider>`.
- **`telenow.campaigns.addTargets(campaignId, targets)`** — fill the platform's
  own campaign instead of creating a parallel app-owned one, so targets land in
  the normal table and the normal engine dials them. Max **1000** per call;
  refreshes the host's views for you. Needs `campaigns:write`.
- **`telenow.ui`** — `openModal` / `closeModal` / `refresh` / `toast`. Use the
  host's chrome instead of drawing your own inside a box; `refresh` is what stops
  the user acting in your panel and then watching a stale table.
- **The JSON Schema now describes `ui.extensions` and `ui.contributions`.** Both
  were server-validated but absent from the schema, so editors gave no
  autocomplete and no warning on a bad `slot`.
- `telenow dev`: `ui.*` are mocked and logged so you can exercise the real code
  path locally. `campaigns.*` and `connector.*` deliberately **refuse** — a fake
  success would make an importer look like it worked while adding nothing.

## 0.4.0
- **`telenow build` validates the newer platform scopes.** `ai:llm`, `ai:tts`,
  `ai:stt` (App AI Gateway), `calls:transcribe:live` (live call streams), and
  `members:read` no longer trip the unknown-scope typo guard.
- **Knowledge-base manifests are validated at build time.** Each
  `knowledgeBases` entry must carry an `id` (the server rejects the whole
  manifest otherwise — the CLI now says so up front, including the common
  `key`→`id` rename) and every document needs a title and body.
- **Custom app icons are packaged.** An `icon.png`/`.jpg`/`.jpeg`/`.webp`
  beside the manifest is added to the zip and overrides the built-in `icon`
  name on the listing.
- **`useObjects` no longer flickers on writes.** `create`, `update`, and `remove`
  now update the local list **optimistically** from the record the server
  returns, instead of re-fetching the whole list after every call. Seeding or
  bulk-editing many rows in a row is now instant and flicker-free.
- **`reload()` is now a background refresh.** It keeps the current list on screen
  while re-syncing; only the *first* load (and a `query` change) shows the
  `loading` spinner. Call it explicitly when you need to pull server-side
  changes that a local optimistic update can't know about.

## 0.3.1
- Prior release.
