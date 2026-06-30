# Releasing `telenow`

Publishing is automated by [`.github/workflows/release.yml`](.github/workflows/release.yml):
publishing a **GitHub Release** builds the package and pushes it to npm.

## One-time setup

1. Create an npm **automation token** with publish rights to the `@telenow` scope
   (npmjs.com → Access Tokens → Generate → *Automation*).
2. Add it as a repo secret: **Settings → Secrets and variables → Actions →
   New repository secret** named `NPM_TOKEN`.

That's the only secret the pipeline needs. Provenance + `--access public` come from
`publishConfig` in `package.json`, so npm shows the verified "built on GitHub" badge.

## Cutting a release

```bash
# 1. bump the version (creates a commit + a vX.Y.Z tag)
npm version patch      # or minor / major

# 2. push the commit and the tag
git push --follow-tags

# 3. create the GitHub Release on that tag (CLI or the web UI)
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

The `release` workflow then runs `npm ci && npm run build`, verifies the tag matches
`package.json`, and publishes to npm. Every push/PR is also built + CLI-smoke-tested
by [`ci.yml`](.github/workflows/ci.yml) across Node 18/20/22, so a broken build never
reaches a tag.

## What gets published

Only the `files` allowlist in `package.json` — `dist/`, `bin/`, the manifest JSON
schema, and `README.md`. `src/` and config stay in the repo but out of the tarball
(`npm pack --dry-run` shows the exact contents; CI runs it on every push).
