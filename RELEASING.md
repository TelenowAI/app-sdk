# Releasing `telenow`

Publishing is automated by [`.github/workflows/release.yml`](.github/workflows/release.yml):
publishing a **GitHub Release** builds the package and pushes it to npm.

## One-time setup

1. Create an npm **automation token** on the account that owns (or will claim) the
   `telenow` package (npmjs.com → Access Tokens → Generate → *Automation*). The very
   first release publishes `telenow` and claims the unscoped name for that account.
2. Add it as a repo secret: **Settings → Secrets and variables → Actions →
   New repository secret** named `NPM_TOKEN`.

That's the only secret the pipeline needs. Provenance + `--access public` come from
`publishConfig` in `package.json`, so npm shows the verified "built on GitHub" badge.

## Cutting a release

```bash
# 0. in CHANGELOG.md, rename the "## Unreleased (X.Y.Z)" heading to "## X.Y.Z" and commit it
#    (npm version does not touch the changelog)

# 1. bump the version (creates a commit + a vX.Y.Z tag)
npm version patch      # or minor / major

# 2. push the commit and the tag
git push --follow-tags

# 3. create the GitHub Release on that tag (CLI or the web UI)
#    with that version's CHANGELOG section as the notes:
V=$(node -p "require('./package.json').version")
awk -v h="## $V" '$0==h{on=1;next} /^## /{on=0} on' CHANGELOG.md > /tmp/notes-$V.md
gh release create "v$V" --notes-file "/tmp/notes-$V.md"
```

The `release` workflow then runs `npm ci && npm run build`, runs the CLI tests, verifies
the tag matches `package.json`, and publishes to npm. Every push/PR is also built, CLI-tested
(`node --test test/cli/*.test.mjs`: the account commands against a local mock server) and
smoke-tested by [`ci.yml`](.github/workflows/ci.yml) across Node 20/22/24 — the versions
`engines` allows — so a broken build never reaches a tag.

## What gets published

Only the `files` allowlist in `package.json` — `dist/` (except the account CLI's own
`.d.ts` / `.map` files under `dist/cli/`, which nothing imports), `bin/`, `skills/` (the
AI-assistant skill `telenow agent-instructions` prints), the manifest JSON schema, and
`README.md`. `src/`, `test/` and config stay in the repo but out of the tarball
(`npm pack --dry-run` shows the exact contents; CI checks them on every push).

## Optional: npm trusted publishing (no long-lived token)

Not set up. Today the workflow publishes with the `NPM_TOKEN` secret (with provenance). npm's
trusted publishing replaces the token with the workflow's own OIDC identity: on npmjs.com, in
the `telenow` package's settings, add a trusted publisher for GitHub Actions — repository
`TelenowAI/app-sdk`, workflow `release.yml` — then drop `NODE_AUTH_TOKEN` from the publish step
and delete the secret. It needs a recent npm CLI in the workflow; check npm's trusted-publishing
docs for the current minimum before switching.
