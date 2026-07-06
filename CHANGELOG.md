# Changelog

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
