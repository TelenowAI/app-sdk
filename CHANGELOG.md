# Changelog

## Unreleased (0.7.0)

### Account commands in the `telenow` command
The `telenow` command now also works with your Telenow account, with an org API key.
Every app command (`app init`, `dev`, `validate`, `build`) works exactly as before.

- **`telenow login`** opens the dashboard in your browser. You check the code,
  pick the org and the key's role, and approve. The CLI then saves a new org API
  key made for this computer in `~/.config/telenow/config.json` (readable only by
  you). The key is named `telenow CLI — <computer> — <date>` and is listed and
  revoked like any other key.
  - Over SSH, in a container, or when an AI assistant runs it, it prints the link
    and the code instead of opening a browser. `--no-browser` asks for that.
  - Keys made this way expire. The CLI says when, and says "this login expired"
    once one has.
  - `--key` asks for an existing key without showing it; scripts pipe one in
    with `--key-stdin`. `TELENOW_API_KEY` overrides the saved key.
  - A server without browser sign-in falls back to asking for a key, and says
    why.
  - Every key is checked with the server before it is saved.
  - Use `--profile` to keep one login per org, and `--base-url` for another
    server.
  - Also `logout` (`--revoke` also revokes the key on the server), `whoami`,
    `profiles list` and `profiles use`.
- **`telenow agents list | get`**: lists show a short view; `--full` shows whole
  rows. Secrets always come back masked.
- **`telenow calls list | get | transcript`**: `calls transcript` prints one line
  per turn, the cheapest form for an AI assistant to read. `calls list --from /
  --to` days are read in your computer's time zone (`--tz` to choose another);
  the server would otherwise use its own.
- **Debugging a call:**
  - `calls cost` shows what a call was charged, line by line. Before the bill is
    settled it says so, and it tells an unknown call from one still going.
  - `calls insights` shows the summary, sentiment and topics; `--generate` makes
    them now (Telenow pays for that, not your org).
  - `calls trace` summarises the debug timeline (owner or admin keys);
    `--out trace.json` saves all of it.
  - `calls recording` lists a call's recordings; `--out` saves one with your key.
    A transferred call has two, and you pick which with `--recording`.
  - `calls live` shows how many calls are going on now, per agent.
- **Exports:** `calls export --out calls.csv` saves the calls as CSV, with the
  same filters as `calls list` plus channel, disposition, campaign and
  `--columns` (`calls export-columns` lists them). It says when the server's row
  limit cut the file short.
- **Files you ask for** (`--out`) are readable only by you. An existing file is
  never replaced without `--force`. A download that stalls or ends early leaves
  nothing behind; a slow one that keeps moving is never cut off.
- **Chat with an agent by text:**
  - `telenow chat <agent-id>` is a conversation in your terminal. Type a number to pick
    one of the options a reply offers.
  - `telenow chat send <agent-id> --message …` is one turn, for scripts and AI
    assistants. It ends the session after the reply unless you pass `--keep`;
    `--session <id>` continues one.
  - Also `chat messages` and `chat end`.
  - The session is always ended on the way out, including on Ctrl-C, because an
    open one keeps counting until it is idle.
  - A chat runs the agent's tools for real, and the CLI names them. An agent
    whose follow-up calls are on for chat can phone people from a chat, so the
    CLI asks first (`--yes` without a terminal).
  - The CLI chats as an id made from your login, never your name;
    `--identifier` chats as a given customer.
- **`telenow models list`**: the providers and models an agent can use, from the
  platform's catalog (`--kind`, `--provider`, `--full` for prices and limits).
  `agents create` and `update` now check `llmProvider`, `llmModel`,
  `sttProvider`, `ttsProvider` and the model in `sttConfig` / `ttsConfig`
  against it, and name the closest ids on a typo. The server saves an unknown
  id, which then fails only when a call starts. `--skip-catalog-check` sends it
  anyway.
- **Phone numbers:** `numbers list | get | search | providers | requirements |
  renewal-risk | reclaimable`.
  - **`numbers buy <+number> --country CC`** repeats the search that showed the
    number. It buys only if that exact number is still offered, at the price the
    carrier gives, and never a price you type. It shows the setup fee, the first
    month and the monthly renewal, then asks (`--yes` without a terminal). A
    retry with the same `--idempotency-key` buys once.
  - **`numbers release`** asks first and says it cannot be undone and nothing is
    refunded. A number on your own carrier account stays yours.
  - **`numbers reclaim`** buys back a number lost for non-payment. It shows the
    old price and asks first.
  - **`numbers assign --agent`** asks first when it would take the number from
    another agent, or clear its default-outbound flag or inbound action (the
    server clears both on every assign). It sends nothing when the number is
    already that agent's.
  - Also `numbers unassign` (asks), `default-outbound [--off]` and
    `inbound-action --action … | --clear`.
  - Sending compliance documents stays in the dashboard.
- **`telenow prompts pull | diff | push`**: keep an agent's live prompt (and, for
  a flow agent, its flow) in local files.
  - `push` checks the prompt with the server first.
  - It saves only if nobody changed the agent since the pull (`If-Match`).
  - It refuses while the dashboard holds an unpublished draft.
  - `pull` never overwrites local edits that were not pushed.
- **Output:** JSON by default. `--fields a,b.c` picks fields, and
  `--output table | raw` changes the format. Errors are JSON on stderr, with
  documented exit codes.
- **Agents:**
  - `agents create | update | delete | versions | diff | restore | stats`.
  - `update` sends only the fields in your file. It merges your `metadata` over
    the agent's current one, under a version check, because the server replaces
    `metadata` whole. `--replace-metadata` sends it as is.
  - Both `create` and `update` warn when a key is snake_case, which the server
    ignores.
- **`flows validate --file`:** checks a graph with the server and saves nothing.
- **`call place`:** dials one person with an agent.
  - It names the number, the agent and the caller ID, then asks first (or needs
    `--yes`).
  - `--queue` lets the server dial within calling hours.
  - `--var name=value` sets call variables.
- **Campaigns:**
  - `campaigns list | get | create` (always a draft).
  - `add-targets` from a `.csv` or `.json` file. The file is checked first; JSON
    goes in batches and is deduplicated by each row's `id`.
  - `start | pause | cancel`: each reads the campaign back to report its real
    status.
  - `calls | results | analytics`.
- **Knowledge bases:** `kb list | get | create | add-doc (--file | --url |
  --text-file) | docs | attach | detach | delete`.
  - `kb attach --doc <id>` limits an agent to some documents of a base, and
    `--whole` widens it back. The server's own routes can only widen by
    replacing all of the agent's bases, so the CLI keeps the others as they
    were and reports any difference afterwards.
  - Plain `kb attach` on a base that is already limited is refused, because
    the server would silently change nothing. `kb attached` shows each base's
    documents.
- **Voices:** `voices list --provider` (filter by `--language`, `--gender`,
  `--limit`) and `voices clones`.
- **Do-not-call list:** `dnc list | add | import | remove`.
- **Webhooks:** `webhooks list | create | test | deliveries | disable | replay`.
  `replay` sends a past event again. It names the event, its time and your
  endpoint's host (never its data), and asks first, because your endpoint may
  act on it twice. A retry with the same `--idempotency-key` sends nothing again,
  and the CLI says so. `create`
  checks event names against the server's own list.
- **Analytics:** `analytics`.
- **Sub-accounts:** `sub-accounts list | get | usage | create | update |
  suspend | resume | rotate-key | close`.
  - **`create` needs a spend limit or `--no-limit` said out loud,** because a
    sub-account spends from your wallet. It also needs `--key-role`.
  - **A new key's secret is shown only once,** so it goes where you say:
    `--save-profile <name>` (a login profile, used with `--profile`),
    `--key-file <path>` (a new owner-only file), or `--show-key` to print it. It
    never appears in output otherwise, `--output raw` included. Create and
    rotate send no idempotency key, so the server never caches the secret;
    `--external-id` makes a retried create safe instead.
  - **`suspend` asks first,** because it ends live calls. **`rotate-key` asks
    first,** because the current keys stop working; `--keep-existing` keeps them.
    **`close` asks first,** because it cannot be undone.
- **Safety:**
  - Anything that dials, spends, deletes or unblocks a number asks first, and
    needs `--yes` when there is no terminal.
  - Every change supports `--dry-run`.
  - Every create sends an `Idempotency-Key`. Pass the same `--idempotency-key`
    to retry a command safely.
  - File uploads are the exception: they go without the key. The server's
    idempotency layer refuses a keyed body over 5 MiB, and knowledge documents
    may be larger.
  - `kb add-doc` prints a short view; the server's answer includes the whole
    document text, so use `--full` to see it.
- **AI assistants:** `telenow agent-instructions` prints the skill shipped in
  `skills/telenow-cli/SKILL.md`.
- **Shell completion:** `telenow completion bash | zsh | fish` prints a completion
  script, generated from the installed version's own commands (app commands
  included). Load it with, for example, `source <(telenow completion bash)`.

### Package
- The account CLI's own type and source-map files are not published (nothing
  imports them). The library's typings are unchanged. The tarball is about
  130 kB.
- CI tests on Node 20, 22 and 24 (Node 18 is dropped, matching `engines`) and
  runs the CLI's tests. The release workflow runs them too before it publishes.

### Requirements
- **Node 20 or newer** (was 18). Node 18 is end-of-life, and its built-in `fetch`
  is still marked experimental.

## 0.6.0

### Agent configuration
- **`telenow.agents.getConfig(agentId)`** — read a bound agent's full setup:
  prompt, model, voice, STT, behaviour, telephony and the flow graph. Secret-free
  (BYOK keys stripped, tools reduced to name/description). Needs
  `agents:config:read`.
- **`telenow.agents.updateConfig(agentId, patch)`** — write settings back. Gated
  **per setting group** (`prompt` · `model` · `voice` · `stt` · `behavior` ·
  `flow` · `telephony` · `analysis`), so an improver app asks only for what it
  changes: each group needs its own `agents:config:write:<group>` scope. The group
  is decided by the FIELD, not the section it appears in, and every group in a
  patch is authorized before any of it is applied. Pass
  `ifUnmodifiedSince: config.updatedAt` to get a conflict instead of overwriting a
  dashboard edit.

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
- **`postCall` in the manifest** — store every finished call into one of your own
  objects, declaratively, with no handler or server: `{ object, mapping, firesOn? }`,
  where `mapping` maps your object's fields to call fields (`call.outcome`,
  `call.to` / `call.from` / `call.ended_at` / `call.attempt`, `keypad.digits` /
  `keypad.choices`, `analysis.summary` / `sentiment` / `disposition` / `topics`,
  `analysis.custom.<name>`, `var.<name>`, or a `'literal'`). Unanswered calls are
  included unless `firesOn` narrows the outcomes.
- **New event topics** an app may subscribe to: `call.machine_detected` (the answer
  was classified as a machine), `call.completed` (every terminal outcome, including
  no-answer and busy; `call.ended` fires only for an answered call) and
  `campaign.call.completed` (a campaign target reached a terminal state; needs
  `campaigns:write`). `AppEventTopic` now lists every topic the platform dispatches.

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

### Files, members
- **`telenow.files.extract(path)`** — plain text out of a stored `.pdf` / `.docx` /
  `.txt` / `.md`, as `{ text, chars, truncated }` (`files:read`).
- **`telenow.members.list()`** — the org's member roster (id, name, email, role).
  Needs `members:read`.

### CLI (`telenow build` / `validate`)
- Validates the newer scopes: `agents:config:read`, `agents:config:write` and the
  eight `agents:config:write:<group>` scopes (listed individually so a typo'd group
  is caught rather than silently refused at runtime), `whatsapp` /
  `whatsapp:templates` / `whatsapp:campaign` / `whatsapp:web`, `links:read` /
  `links:write`, and `calls:context`.
- Knows every event topic the platform dispatches: the native-WhatsApp ones
  (`whatsapp.message.received`, `whatsapp.message.status`,
  `whatsapp.account.health`) and `call.machine_detected`, `call.completed` and
  `campaign.call.completed`, which `validate` previously refused as unknown.
- Documents the **two scope planes** in-source: the UI bridge (`whatsapp:send`)
  and the app-key REST surface (`whatsapp`). An app that sends from a page AND
  from its backend needs both — declaring one silently fails on the other plane.

### WhatsApp
- **`telenow.whatsapp.sendTemplate(…, { buttonIndex })`** — which button
  `urlSuffix` fills, counting from 0 in the order the buttons appear on the
  template. Omit it unless the template has more than one URL button; it defaults
  to the first.

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
