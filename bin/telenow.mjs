#!/usr/bin/env node
// `telenow build` — bundle an app's React UI and assemble the uploadable ZIP.
//
// Run in a folder that contains:
//   telenow.app.json   (manifest; ui.entry points at your SOURCE entry, e.g. "ui/index.tsx")
//   ui/index.tsx       (your React entry — calls mount(App) from telenow/react)
//   README.md          (optional; shown on the marketplace listing)
//   screenshots/*.png  (optional; shown on the listing)
//
// It produces `<appId>-<version>.telenow.zip` with the BUILT bundle
// (ui/index.js[+css]), the manifest (refs rewritten), README, and screenshots —
// exactly the package format the platform's validator accepts.

import {
  readFileSync, existsSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync,
} from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

function die(msg) {
  console.error(`telenow: ${msg}`);
  process.exit(1);
}

async function load(name) {
  try {
    return (await import(name)).default ?? (await import(name));
  } catch {
    die(`missing dependency '${name}'. Run: npm i -D ${name}`);
  }
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

// ── Manifest validation (mirrors the server's app_manifest::validate so the
//    first failure happens at the keyboard, not at upload). Returns
//    { errors, warnings }; the build + the `validate` command both use it. ─────

const KEY_SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KNOWN_RUNTIMES = new Set(['declarative', 'sandboxed', 'external']);
const KNOWN_SCOPES = new Set([
  'user:profile', 'session:token',
  'agents:read', 'agents:write',
  'calls:read', 'calls:read:org', 'calls:initiate',
  'whatsapp:send', 'softphone:dial',
  'files:read', 'files:write',
  'campaigns:read', 'campaigns:write',
  'data:read', 'data:write',
  'billing:read',
  'kb:read', 'kb:write',
  'ai:llm', 'ai:tts', 'ai:stt',
  'calls:transcribe:live',
  'members:read',
]);
const SCOPE_PREFIXES = ['objects:', 'http:', 'connection:'];
const KNOWN_EVENT_TOPICS = new Set([
  'call.started', 'call.ended', 'call.analyzed', 'recording.ready',
  // Mid-call live topics — additionally require calls:read (or calls:read:org).
  'call.turn', 'call.barge_in', 'call.silence', 'call.dtmf', 'call.node_entered',
  // Settlement event — additionally requires billing:read.
  'charge.settled',
]);
// Fixed topic, or object.<type>.created (incl. the object.*.created wildcard).
function isValidEventTopic(on) {
  return (
    KNOWN_EVENT_TOPICS.has(on) ||
    (on.startsWith('object.') && on.endsWith('.created') && on.length > 'object..created'.length)
  );
}

function validateManifest(m, { cwd } = {}) {
  const errors = [];
  const warnings = [];
  const E = (s) => errors.push(s);
  const W = (s) => warnings.push(s);

  // id + version
  if (!m.id || !String(m.id).trim()) E('id is required');
  else if (!KEY_SAFE.test(String(m.id).trim())) E("id may only contain letters, digits, '.', '-', '_'");
  if (!m.version || !String(m.version).trim()) E('version is required');
  else {
    const v = String(m.version).trim();
    if (!KEY_SAFE.test(v)) E("version may only contain letters, digits, '.', '-', '_'");
    else if (!SEMVER.test(v)) W(`version '${v}' is not semantic versioning (e.g. 1.2.0) — recommended, and required to move the marketplace channel forward`);
  }

  if (m.runtime != null && !KNOWN_RUNTIMES.has(m.runtime)) {
    W(`unknown runtime '${m.runtime}' — expected declarative | sandboxed | external`);
  }

  // objects — unique types
  const objects = Array.isArray(m.objects) ? m.objects : [];
  const objTypes = new Set();
  for (const o of objects) {
    const t = o && o.type;
    if (!t || !String(t).trim()) { E('object.type is required'); continue; }
    if (objTypes.has(t)) E(`duplicate object type '${t}'`);
    objTypes.add(t);
  }

  // tools — name, object refs, match fields, http base_url
  const fieldsOf = (type) => {
    const o = objects.find((x) => x && x.type === type);
    return new Set((o && Array.isArray(o.fields) ? o.fields : []).map((f) => f && f.key));
  };
  for (const t of Array.isArray(m.tools) ? m.tools : []) {
    const name = t && t.name;
    if (!name || !String(name).trim()) { E('tool.name is required'); continue; }
    const h = t.handler || {};
    const kind = h.kind || '';
    if (String(kind).startsWith('object.')) {
      const obj = h.object;
      if (!obj) E(`tool '${name}' handler is missing \`object\``);
      else if (!objTypes.has(obj)) E(`tool '${name}' references undeclared object '${obj}'`);
      if (kind === 'object.update' || kind === 'object.delete') {
        const mf = (h.match || '').trim();
        if (!mf) E(`tool '${name}' (${kind}) needs a \`match\` field`);
        else if (obj && objTypes.has(obj) && !fieldsOf(obj).has(mf)) {
          E(`tool '${name}' match field '${mf}' is not a declared field of '${obj}'`);
        }
      }
    }
    if (kind === 'http' && !(m.base_url && String(m.base_url).trim())) {
      E(`tool '${name}' is http but the manifest has no base_url`);
    }
  }

  // events — recognised topic + object refs (mirrors the server gate)
  for (const e of Array.isArray(m.events) ? m.events : []) {
    const on = e && e.on;
    if (!on || !isValidEventTopic(on)) {
      E(`event '${on}' is not a recognised topic (${[...KNOWN_EVENT_TOPICS].join(' | ')} | object.<type>.created)`);
    }
    const obj = e && e.handler && e.handler.object;
    if (obj && !objTypes.has(obj)) E(`event '${on}' references undeclared object '${obj}'`);
  }

  // ui — entry required when pages declared, unique page ids, source exists
  const ui = m.ui && typeof m.ui === 'object' && !Array.isArray(m.ui) ? m.ui : {};
  const pages = Array.isArray(ui.pages) ? ui.pages : [];
  if (pages.length && !(ui.entry && String(ui.entry).trim())) {
    E('ui.entry (the React bundle entry) is required when ui.pages are declared');
  }
  const pageIds = new Set();
  for (const p of pages) {
    const id = p && p.id;
    if (!id || !String(id).trim()) { E('ui page id is required'); continue; }
    if (pageIds.has(id)) E(`duplicate ui page id '${id}'`);
    pageIds.add(id);
  }
  if (cwd && ui.entry && String(ui.entry).trim() && !existsSync(join(cwd, ui.entry))) {
    E(`ui.entry source '${ui.entry}' not found`);
  }

  // knowledgeBases — each needs an `id` (the server's parse rejects the whole
  // manifest with "missing field `id`" otherwise) + titled/bodied documents.
  for (const kb of Array.isArray(m.knowledgeBases) ? m.knowledgeBases : []) {
    if (!kb || !kb.id || !String(kb.id).trim()) {
      E(`knowledgeBases entry is missing \`id\`${kb && kb.key ? ` (found \`key\` — rename it to \`id\`)` : ''}`);
      continue;
    }
    for (const d of Array.isArray(kb.documents) ? kb.documents : []) {
      if (!d || !d.title || !d.body) E(`knowledge base '${kb.id}' has a document without a title/body`);
    }
  }

  // scopes — warn on shapes the platform doesn't recognise (typo guard)
  for (const s of Array.isArray(m.scopes) ? m.scopes : []) {
    if (typeof s !== 'string') { E('scopes must be strings'); continue; }
    if (!KNOWN_SCOPES.has(s) && !SCOPE_PREFIXES.some((p) => s.startsWith(p))) {
      W(`unrecognised scope '${s}' — it may silently grant nothing. Known: ${[...KNOWN_SCOPES].join(', ')}, objects:<type>, http:<host>, connection:<provider>`);
    }
  }

  return { errors, warnings };
}

function reportValidation(res, { strict } = {}) {
  for (const w of res.warnings) console.warn(`  ⚠ ${w}`);
  for (const e of res.errors) console.error(`  ✗ ${e}`);
  if (res.errors.length) die(`${res.errors.length} manifest error(s) — fix them and re-run`);
  if (strict && res.warnings.length) {
    console.log(`✓ valid (${res.warnings.length} warning(s))`);
  }
}

function validate() {
  const cwd = process.cwd();
  const manifestPath = join(cwd, 'telenow.app.json');
  if (!existsSync(manifestPath)) die('no telenow.app.json in the current folder');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    die(`telenow.app.json is not valid JSON: ${e.message}`);
  }
  const res = validateManifest(manifest, { cwd });
  reportValidation(res, { strict: true });
  if (!res.warnings.length) console.log('✓ telenow.app.json is valid');
}

async function build() {
  const cwd = process.cwd();
  const manifestPath = join(cwd, 'telenow.app.json');
  if (!existsSync(manifestPath)) die('no telenow.app.json in the current folder');

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    die(`telenow.app.json is not valid JSON: ${e.message}`);
  }
  // Fail fast on the same checks the server runs at upload.
  reportValidation(validateManifest(manifest, { cwd }));

  const out = { ...manifest };
  delete out.$schema; // editor-only hint; not part of the published manifest
  const hasUi = manifest.ui && manifest.ui.entry;

  if (hasUi) {
    const srcEntry = join(cwd, manifest.ui.entry);
    if (!existsSync(srcEntry)) die(`ui.entry source '${manifest.ui.entry}' not found`);

    const esbuild = await load('esbuild');
    const tmp = mkdtempSync(join(tmpdir(), 'telenow-ui-'));

    // Dedupe React: force the app's SINGLE copy so the SDK's `react` import and
    // the app's `react` import resolve to the same instance. Two copies make
    // React's hook dispatcher null → "Cannot read properties of null (reading
    // 'useState')" and a blank screen. Resolved from the app folder (cwd).
    const req = createRequire(join(cwd, 'package.json'));
    const alias = {};
    for (const pkg of ['react', 'react-dom']) {
      try {
        alias[pkg] = dirname(req.resolve(`${pkg}/package.json`));
      } catch {
        /* not a dependency here — leave it for esbuild to resolve normally */
      }
    }

    console.log(`• bundling ${manifest.ui.entry} …`);
    try {
      await esbuild.build({
        entryPoints: [srcEntry],
        bundle: true,
        format: 'iife',
        jsx: 'automatic',
        minify: true,
        // keepNames preserves component/function names so the error overlay +
        // retained logs show real names (browsers never symbolicate the .stack
        // string). The INLINE sourcemap travels inside the bundle as a data URI
        // — the app is served from per-object signed URLs, so a relative
        // `.map` reference can't resolve; inline always does, and DevTools then
        // shows real TSX file:line.
        keepNames: true,
        sourcemap: 'inline',
        target: ['es2019'],
        outfile: join(tmp, 'index.js'),
        loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
        alias,
        logLevel: 'warning',
      });
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true });
      die(`bundle failed: ${e.message}`);
    }
    out._uiTmp = tmp; // carried to zip step
    out.ui = { ...manifest.ui, entry: 'ui/index.js' };
    if (existsSync(join(tmp, 'index.css'))) out.ui.styles = 'ui/index.css';
  }

  // Screenshots: pick up images from ./screenshots if not already declared.
  let shots = Array.isArray(manifest.screenshots) ? manifest.screenshots.slice() : [];
  const shotsDir = join(cwd, 'screenshots');
  if (shots.length === 0 && existsSync(shotsDir)) {
    shots = readdirSync(shotsDir)
      .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
      .sort()
      .map((f) => ({ file: `screenshots/${f}` }));
  }
  if (shots.length) out.screenshots = shots;

  // Assemble the ZIP.
  const AdmZip = await load('adm-zip');
  const zip = new AdmZip();
  const tmp = out._uiTmp;
  delete out._uiTmp;
  zip.addFile('telenow.app.json', Buffer.from(JSON.stringify(out, null, 2)));
  if (existsSync(join(cwd, 'README.md'))) {
    zip.addFile('README.md', readFileSync(join(cwd, 'README.md')));
  }
  // Per-version "what's new" notes, shown on the listing + update prompt.
  if (existsSync(join(cwd, 'CHANGELOG.md'))) {
    zip.addFile('CHANGELOG.md', readFileSync(join(cwd, 'CHANGELOG.md')));
  }
  if (tmp) {
    zip.addFile('ui/index.js', readFileSync(join(tmp, 'index.js')));
    if (out.ui.styles) zip.addFile('ui/index.css', readFileSync(join(tmp, 'index.css')));
    rmSync(tmp, { recursive: true, force: true });
  }
  for (const s of shots) {
    const p = join(cwd, s.file);
    if (!existsSync(p)) die(`screenshot '${s.file}' not found`);
    zip.addFile(s.file, readFileSync(p));
  }
  // Custom app logo beside the manifest — the server validator picks it up and
  // it overrides any built-in `icon` name on the listing.
  for (const name of ['icon.png', 'icon.jpg', 'icon.jpeg', 'icon.webp']) {
    if (existsSync(join(cwd, name))) {
      zip.addFile(name, readFileSync(join(cwd, name)));
      break;
    }
  }

  const outName = `${manifest.id}-${manifest.version}.telenow.zip`;
  zip.writeZip(join(cwd, outName));
  console.log(`✓ wrote ${outName} — upload it in the Telenow dashboard (Apps → Upload custom app).`);
}

// ── telenow dev — local live preview (mock bridge + hot reload) ─────────────
//
// Serves your app from http://localhost:<port> two ways:
//   • open the URL directly  → STANDALONE preview with a mock window.telenow
//     (in-memory/localStorage data, fake agents/calls) — no server, offline.
//   • paste the URL into the dashboard's "Dev preview" for your app → LIVE
//     preview: the real dashboard loads THIS bundle into its sandboxed iframe,
//     so your local code runs against real data/agents/scopes under your login.
// Either way, saving a file rebuilds and hot-reloads.

function getFlag(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : fallback;
}

function ctypeFor(file) {
  const l = file.toLowerCase();
  if (l.endsWith('.js') || l.endsWith('.mjs')) return 'text/javascript';
  if (l.endsWith('.css')) return 'text/css';
  if (l.endsWith('.map') || l.endsWith('.json')) return 'application/json';
  if (l.endsWith('.html')) return 'text/html';
  return 'application/octet-stream';
}

// Mock data/fixtures: from telenow.dev.json if present, else empty (the app can
// create rows live — they persist to localStorage in the browser).
function loadFixtures(cwd, manifest) {
  let fx = {};
  const p = join(cwd, 'telenow.dev.json');
  if (existsSync(p)) {
    try {
      fx = JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      die(`telenow.dev.json is not valid JSON: ${e.message}`);
    }
  }
  const pages = (manifest.ui && manifest.ui.pages) || [];
  fx.context = {
    appId: manifest.id,
    title: manifest.name || manifest.id,
    page: (fx.context && fx.context.page) || (pages[0] && pages[0].id) || 'home',
    ...(fx.context || {}),
  };
  return fx;
}

function hostHtml(manifest, port, fixtures) {
  const pages = (manifest.ui && manifest.ui.pages) || [];
  const tabs = pages
    .map(
      (p) =>
        `<button class="tn-tab" data-page="${p.id}">${(p.title || p.id).replace(/</g, '&lt;')}</button>`,
    )
    .join('');
  const name = (manifest.name || manifest.id).replace(/</g, '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — telenow dev</title>
<style>
  html,body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#111}
  #tn-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;background:#0f172a;color:#e2e8f0;font-size:13px}
  #tn-bar b{color:#fff}
  #tn-bar .tn-pill{background:#1e293b;border-radius:999px;padding:2px 9px;font-size:11px;color:#93c5fd}
  .tn-tab{background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer}
  .tn-tab.active{background:#2563eb;color:#fff;border-color:#2563eb}
  #root{min-height:calc(100vh - 40px)}
</style></head><body>
<div id="tn-bar">
  <b>${name}</b><span class="tn-pill">telenow dev · mock data</span>
  <span style="flex:1"></span>${tabs}
</div>
<div id="root"></div>
<script>
  (function(){
    var pages = ${JSON.stringify(pages.map((p) => p.id))};
    var page = new URLSearchParams(location.search).get('page') || pages[0] || 'home';
    window.__TN_FIX__ = Object.assign(${JSON.stringify(fixtures || {})}, window.__TN_FIX__);
    window.__TN_FIX__.context = Object.assign({}, window.__TN_FIX__.context, { page: page, pageId: page });
    Array.prototype.forEach.call(document.querySelectorAll('.tn-tab'), function(b){
      if(b.dataset.page === page) b.classList.add('active');
      b.addEventListener('click', function(){ location.search = '?page=' + encodeURIComponent(b.dataset.page); });
    });
  })();
</script>
<script src="/__boot.js"></script>
<script src="/index.js"></script>
</body></html>`;
}

async function dev() {
  const cwd = process.cwd();
  const manifestPath = join(cwd, 'telenow.app.json');
  if (!existsSync(manifestPath)) die('no telenow.app.json in the current folder');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    die(`telenow.app.json is not valid JSON: ${e.message}`);
  }
  reportValidation(validateManifest(manifest, { cwd }));

  const entry = manifest.ui && manifest.ui.entry;
  if (!entry) die('telenow.app.json has no ui.entry to serve');
  const srcEntry = join(cwd, entry);
  if (!existsSync(srcEntry)) die(`ui.entry source '${entry}' not found`);

  const port = Number(getFlag('--port', '5174')) || 5174;
  const fixtures = loadFixtures(cwd, manifest);
  const esbuild = await load('esbuild');
  const tmp = mkdtempSync(join(tmpdir(), 'telenow-dev-'));

  // Same React-dedup alias as `build` (two React copies → null hook dispatcher).
  const req = createRequire(join(cwd, 'package.json'));
  const alias = {};
  for (const pkg of ['react', 'react-dom']) {
    try {
      alias[pkg] = dirname(req.resolve(`${pkg}/package.json`));
    } catch {
      /* leave for esbuild to resolve */
    }
  }

  // Live-reload fan-out (SSE).
  const clients = new Set();
  const notify = () => {
    for (const res of clients) {
      try {
        res.write('data: reload\n\n');
      } catch {
        /* client gone */
      }
    }
  };

  // App bundle — watched; rebuild → notify.
  const ctx = await esbuild.context({
    entryPoints: [srcEntry],
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    keepNames: true,
    sourcemap: 'inline',
    target: ['es2019'],
    outfile: join(tmp, 'index.js'),
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
    alias,
    logLevel: 'silent',
    plugins: [
      {
        name: 'telenow-reload',
        setup(b) {
          b.onEnd((r) => {
            const errs = (r.errors || []).length;
            if (errs) {
              console.error(`  ✗ build error (${errs}) — ${(r.errors[0] && r.errors[0].text) || ''}`);
            } else {
              console.log(`  • rebuilt ${new Date().toLocaleTimeString()}`);
            }
            notify();
          });
        },
      },
    ],
  });
  await ctx.watch();

  // Bootstrap (built once): installs the mock bridge + live-reload client. In
  // LIVE preview the dashboard injects its OWN real bridge and ignores this.
  try {
    await esbuild.build({
      stdin: {
        contents: `import { createMockBridge } from 'telenow/browser';
window.telenow = createMockBridge(window.__TN_FIX__ || {});
try { var es = new EventSource('/__livereload'); es.onmessage = function(){ location.reload(); }; } catch (e) {}
`,
        resolveDir: cwd,
        loader: 'js',
      },
      bundle: true,
      format: 'iife',
      target: ['es2019'],
      outfile: join(tmp, '__boot.js'),
      logLevel: 'silent',
    });
  } catch (e) {
    die(`couldn't build the dev bootstrap (is telenow installed?): ${e.message}`);
  }

  const server = createServer((rq, rs) => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    const url = (rq.url || '/').split('?')[0];
    if (url === '/__livereload') {
      rs.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...cors,
      });
      rs.write('\n');
      clients.add(rs);
      rq.on('close', () => clients.delete(rs));
      return;
    }
    if (url === '/' || url === '/index.html') {
      rs.writeHead(200, { 'Content-Type': 'text/html', ...cors });
      rs.end(hostHtml(manifest, port, fixtures));
      return;
    }
    if (url === '/telenow.app.json') {
      rs.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      rs.end(JSON.stringify(manifest));
      return;
    }
    // Static files from the build tmp dir (index.js[.map], __boot.js, index.css).
    const safe = url.replace(/[^A-Za-z0-9._/-]/g, '').replace(/\.\.+/g, '.').replace(/^\/+/, '');
    const file = join(tmp, safe);
    if (file.startsWith(tmp) && existsSync(file)) {
      rs.writeHead(200, { 'Content-Type': ctypeFor(file), 'Cache-Control': 'no-store', ...cors });
      rs.end(readFileSync(file));
      return;
    }
    rs.writeHead(404, cors);
    rs.end('not found');
  });

  const shutdown = () => {
    try { ctx.dispose(); } catch {}
    try { server.close(); } catch {}
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') die(`port ${port} is in use — try: telenow dev --port ${port + 1}`);
    die(`dev server error: ${e.message}`);
  });
  server.listen(port, () => {
    console.log(`
  telenow dev → http://localhost:${port}

  • Standalone:  open the URL above (mock data, edit + save = hot reload)
  • Live preview: in the dashboard open ${manifest.id} → "Dev preview" →
                  paste http://localhost:${port} (runs against REAL data)

  watching ${entry} … (Ctrl-C to stop)
`);
  });
}

// ── telenow app init <name> — scaffold a new app folder ─────────────────────

const SCAFFOLD = {
  'telenow.app.json': `{
  "$schema": "./node_modules/telenow/telenow.app.schema.json",
  "id": "my-app",
  "version": "1.0.0",
  "name": "My App",
  "runtime": "declarative",
  "category": "other",
  "blurb": "A starter Telenow app.",
  "icon": "box",
  "scopes": ["objects:note"],
  "objects": [
    { "type": "note", "label": "Note", "fields": [
      { "key": "title", "type": "text" },
      { "key": "body", "type": "text" }
    ] }
  ],
  "ui": {
    "entry": "ui/index.tsx",
    "pages": [{ "id": "notes", "title": "Notes", "icon": "file", "menu": true }]
  }
}
`,
  'README.md': `# My App

A starter Telenow app. Edit \`ui/App.tsx\` and \`telenow.app.json\`, then:

\`\`\`bash
npm install
npx telenow build      # → my-app-1.0.0.telenow.zip
\`\`\`

Upload it in **Apps → Your apps → Upload app zip**. To list on the marketplace,
add screenshots under \`screenshots/\` + an \`icon.png\`, then **Publish to marketplace**.
`,
  'CHANGELOG.md': `## 1.0.0\n- Initial release.\n`,
  'telenow.dev.json': `{
  "seed": {
    "note": [
      { "title": "Welcome", "body": "This is a seeded note." },
      { "title": "Todo", "body": "Try editing App.tsx — it hot-reloads." }
    ]
  },
  "agents": [{ "id": "agent-front-desk", "name": "Front Desk" }],
  "user": { "id": "dev-1", "role": "owner", "permissions": ["view", "manage_agents"], "name": "Dr. Dev", "email": "dev@clinic.test" }
}
`,
  'package.json': `{
  "name": "my-app",
  "private": true,
  "version": "1.0.0",
  "scripts": { "build": "telenow build" },
  "dependencies": {
    "telenow": "latest",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}
`,
  'ui/index.tsx': `import { mount } from 'telenow/react';
import App from './App';

mount(App);
`,
  'ui/App.tsx': `import { useState } from 'react';
import { useObjects, useTelenowContext } from 'telenow/react';

interface Note { title: string; body?: string }

export default function App() {
  useTelenowContext();
  const { data, loading, create, remove } = useObjects<Note>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  if (loading) return <p style={{ padding: 16 }}>Loading…</p>;
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', maxWidth: 640 }}>
      <h1 style={{ fontSize: 20 }}>Notes</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          await create({ title, body });
          setTitle('');
          setBody('');
        }}
        style={{ display: 'flex', gap: 8, margin: '12px 0' }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {data.map((n) => (
          <li key={n.id}>
            <strong>{n.data.title}</strong> {n.data.body}{' '}
            <button onClick={() => remove(n.id)}>delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
`,
  'screenshots/PUT_SCREENSHOTS_HERE.txt':
    'Drop PNG/JPG screenshots here — they appear on your marketplace listing.\nAlso add an icon.png in the project root for your app logo.\n',
};

function init(name) {
  const app = (name || 'my-app').trim();
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/i.test(app)) {
    die('app name must be alphanumeric (dots, dashes, underscores allowed)');
  }
  const dir = join(process.cwd(), app);
  if (existsSync(dir)) die(`folder '${app}' already exists`);
  for (const [rel, content] of Object.entries(SCAFFOLD)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content.split('my-app').join(app));
  }
  console.log(`✓ created ${app}/ — next:\n    cd ${app} && npm install && npx telenow build`);
}

const cmd = process.argv[2];
if (cmd === 'build') {
  build().catch((e) => die(e.message));
} else if (cmd === 'dev') {
  dev().catch((e) => die(e.message));
} else if (cmd === 'validate') {
  validate();
} else if (cmd === 'app' && process.argv[3] === 'init') {
  init(process.argv[4]);
} else if (cmd === 'init') {
  init(process.argv[3]); // alias for `telenow app init`
} else {
  console.log('Usage:\n  telenow app init <name>   scaffold a new app\n  telenow dev [--port N]    live preview with hot reload (mock or in-dashboard)\n  telenow validate          check telenow.app.json for errors\n  telenow build             validate, bundle + zip the app in this folder');
  process.exit(cmd ? 1 : 0);
}
