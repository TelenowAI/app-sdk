---
name: telenow-cli
description: Use the `telenow` command to work with a Telenow voice AI account from the terminal — list and inspect agents, read call transcripts, pull an agent's prompt or flow into local files, edit and push it back safely, create or change agents, place a test call, run campaigns, manage knowledge bases, do-not-call lists and webhooks. Use it whenever the user asks about their Telenow agents, calls, transcripts, prompts, flows or campaigns, or wants to change them, instead of guessing at the REST API.
---

# Telenow CLI

`telenow` talks to the user's Telenow account with an org API key. Output is JSON on stdout;
notes and errors are JSON lines on stderr. Exit codes: 0 ok · 1 bad input or refused locally ·
2 not signed in / key role not allowed · 3 not found · 4 conflict (someone changed it, or an
unpublished dashboard draft) · 5 rate limited · 6 server error · 7 network.

## Before anything

- `telenow whoami` — which org and key role you are acting as. A `viewer` or `member` key can
  read but not change agents.
- Not signed in (exit 2): ask the user to run `telenow login` in their own terminal. It opens
  their browser; they check the code, pick the org and click Approve, and a new key for this
  computer is saved.
- If you run `telenow login` yourself, run it in the background: it waits until the code
  expires (it says how long). Read its stderr and show the user the link and the code it
  prints. They open the link, check the code matches and approve; the command then finishes
  by itself. Never approve on the user's behalf.
- Exit 2 `login_expired`: the saved login's key has expired; ask the user to sign in again the
  same way.
- Never ask the user to paste an API key into the chat, and never put a key on a command line.
  In CI, `TELENOW_API_KEY` is set by the environment.
- `telenow logout --revoke` revokes this computer's key on the server, then forgets it.

## Read cheaply

- Always pass `--fields` with the fields you need: `telenow calls list --fields id,status,duration_sec`.
  Lists show a short view by default; `--full` gives whole rows.
- `telenow calls transcript <call-id>` prints one line per turn — the cheapest way to read a call.
- A list that has more pages says so on stderr (`{"more":{"total":…,"nextOffset":…}}`); add
  `--offset` or `--all`.

## Talk to an agent by text

- `telenow chat send <agent-id> --message "…"` sends one message and prints `{ reply, sessionId, ended }`.
  The session is ended after the reply. To hold a conversation, start with `--keep`, then send each next
  message with `--session <id>`, and end with `--end` on the last one (or `telenow chat end <id>`). Never
  leave a session open.
- A chat runs the agent's tools for real (bookings, CRM writes). If the CLI says the agent can phone people
  from a chat (exit 1 `needs_yes`), ask the user before adding `--yes`.
- `--var name=value` sets variables on the first message only. `--identifier <id>` chats as a particular
  customer; use the same one on every message of that session.
- Exit 1 `SESSION_EXPIRED`: the session ended. Send again without `--session`.
- `telenow chat messages <session-id> --format text` reads a session back.

## Find out why a call went wrong

- `telenow calls transcript <call-id>` first, then:
- `telenow calls cost <call-id>` — the charge, line by line (`settled:false` for a few minutes
  after the call ends).
- `telenow calls insights <call-id>` — summary, sentiment, topics; `--generate` if there are none.
- `telenow calls trace <call-id>` — a summary of the debug timeline (owner or admin key; the
  agent needs debug mode). The whole trace can be MBs: save it with `--out trace.json` and read
  only the parts you need from the file.
- `telenow calls recording <call-id>` lists the audio; `--out <file>` saves one (with
  `--recording <id>` when there are two, as after a transfer).
- `telenow calls export --out calls.csv --from <day> --to <day>` for many calls at once
  (`calls export-columns` lists `--columns`). Days are read in the computer's time zone unless
  `--tz` says otherwise. `--out` never replaces a file without `--force`.

## Change an agent's prompt or flow

1. `telenow prompts pull <agent-id>` — writes `.telenow/agents/<id>/prompt.md` (and `flow.json`
   for a flow agent). Edit those files only.
2. `telenow prompts diff <agent-id>` — show the change to the user.
3. `telenow prompts push <agent-id> --dry-run`, then `telenow prompts push <agent-id>`.
   - Exit 4 `agent_version_conflict`: someone saved since the pull. Do NOT `--force`; tell the
     user, pull again (`--force` on pull only after they agree to drop the local edit).
   - Exit 4 `dashboard_draft`: the dashboard holds unpublished changes; ask the user to publish
     or discard them first. `--ignore-draft` only on the user's explicit say-so.
   - Exit 1 `invalid_prompt`: fix what the errors name; nothing was saved.
- `telenow flows validate --file flow.json` checks a graph without saving.
- Other settings: `telenow agents update <id> --file patch.json` with only the fields to change,
  in camelCase (`systemPrompt`, `ttsVoice`). Its `metadata` keys are merged into the agent's.
- Models: `telenow models list --kind llm` (or `stt`, `tts`) gives the ids to use. `agents create`
  and `update` refuse an id the catalog does not list (exit 1 `not_in_catalog`, with the closest
  ids); fix the id rather than adding `--skip-catalog-check`, unless the user says the model is
  meant to be outside the catalog.

## What else it does

- Agents: `agents create --file`, `agents update <id> --file` (camelCase fields; `metadata` keys
  are merged), `agents versions | diff | restore | stats`.
- Calls: `call place --agent <id> --to +<number>` (`--queue` lets the server pick a time inside
  calling hours — prefer it for customers), `calls list | get | transcript`, `calls live`.
- Campaigns: `campaigns create` (a draft) → `campaigns add-targets <id> --file people.csv|.json`
  → `campaigns start <id>`; then `campaigns calls | results | analytics`; `pause`, `cancel`.
  In `.json`, give each person an `id`: a re-run then adds nobody twice.
- Knowledge: `kb create --name`, `kb add-doc <kb-id> --file | --url | --text-file`, `kb docs`
  (wait for `embedded`), `kb attach <kb-id> --agent <id>` (whole base; `--doc <id>` repeated for only
  some documents, `--whole` to widen again), `kb attached --agent <id>` to see what it reads.
- `voices list --provider <p> --language hi --gender female` to pick a `ttsVoice`.
- Numbers: `numbers list | get | search --country US`; `numbers assign <id> --agent <id>` (asks if it
  takes the number from another agent); `default-outbound`, `inbound-action --action … | --clear`;
  `renewal-risk`, `reclaimable`.
- `dnc add | import | list`, `webhooks create | test | deliveries`, `analytics`.
- Sub-accounts (owner or admin keys only):
  - `sub-accounts list | get | usage`;
  - `create --name … --monthly-limit <usd> --key-role … --save-profile <name>`. A sub-account spends from
    the user's wallet: ask the user for the limit and the role, never pick them;
  - never use `--show-key` unless the user asks: the secret would land in this conversation.

## Things that dial, spend, send or delete

`telenow call place`, `campaigns start | cancel`, `campaigns add-targets` to a running campaign,
`dnc remove`, `webhooks disable | replay`, `numbers buy | release | reclaim` (money; a release cannot be
undone), `numbers assign | unassign` when they move a number, `sub-accounts suspend | rotate-key | close`,
and every delete ask before they act; with no terminal they need
`--yes`. **Only add `--yes` after the user has confirmed, in this
conversation, exactly who is called or what is started or deleted.** Run with `--dry-run` first
and show the user the request. When retrying a `call place` or a create after a timeout, pass
the same `--idempotency-key` so it happens once.

## Help

`telenow --help` lists every command; `telenow <command> --help` its options;
`telenow completion bash|zsh|fish` prints a tab-completion script for people at a terminal.
