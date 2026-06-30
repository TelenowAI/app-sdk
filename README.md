# telenow

SDK for building **installable apps** on the Telenow App Platform — like a Shopify app or a WordPress plugin, but for the Telenow voice AI dashboard and agent.

An app declares a **manifest** (`telenow.app.json`) describing its data objects, the tools the voice agent can call, its dashboard UI, and event hooks. Declarative apps run on Telenow's runtime with no hosting. **External apps** run on your own server — this SDK is for them.

It does three things:

1. **A React dashboard UI** — build any UI you want with React; it renders inside the Telenow dashboard (sidebar menu + page) in a sandboxed iframe. `telenow/react` gives you `useObjects()` and friends; `telenow build` packages it.
2. **Verifies signed requests** — the platform signs every agent tool call and event webhook with `X-Telenow-Signature: sha256=<hex>` (HMAC-SHA256 over the raw body).
3. **Reads/writes your app's data** via the scoped **Data API** — your per-install app key is bound to one `(org, app)`, so you can never touch another tenant's or app's data.

## Dashboard UI (React)

Your app can contribute pages to the Telenow dashboard. Declare them in the manifest and write a React app:

```jsonc
// telenow.app.json
"ui": {
  "entry": "ui/index.tsx",              // your React entry (bundled by `telenow build`)
  "pages": [
    { "id": "appointments", "title": "Appointments", "icon": "calendar", "menu": true }
  ]
}
```

```tsx
// ui/App.tsx
import { useObjects, useTelenowContext } from 'telenow/react';

export default function App() {
  const { page } = useTelenowContext();                 // which page the user opened
  const { data, loading, create } = useObjects('appointment');
  if (loading) return <p>Loading…</p>;
  return <Calendar events={data} onBook={(a) => create(a)} />;
}
```

```tsx
// ui/index.tsx
import { mount } from 'telenow/react';
import App from './App';
mount(App);
```

Your UI runs in a **sandboxed iframe on an opaque origin** — it cannot read the dashboard's cookies or tokens. `useObjects` / `telenow.data.*` calls are relayed to the dashboard, which performs them under the signed-in user, scoped to your app. There are **no API keys in the browser**.

Each manifest `page` becomes a sidebar menu item; uninstalling the app removes them. See [`examples/doctor-crm`](../examples/doctor-crm).

## Talking to the dashboard from your UI

Your UI gets more than data access — each capability is gated by a **scope** you declare in the manifest and the org consents to at install. Every call is relayed under the signed-in user and enforced server-side.

```tsx
import {
  useUser, useAgents, useCall, useWhatsapp,
  useSoftphone, useSession, useHttp,
} from 'telenow/react';

const { user, can } = useUser();              // identity + RBAC (user:profile for name/email)
const { agents } = useAgents();               // agents:read
const { initiate, history } = useCall();      // calls:initiate / calls:read
const { send } = useWhatsapp();               // whatsapp:send
const { dial } = useSoftphone();              // softphone:dial — opens the dashboard dialer prefilled
```

**Third-party APIs** — `useHttp` proxies through the dashboard server (no CORS; the browser never reaches the API directly). The host must be in your declared `http:<host>` scopes:

```tsx
const { fetch } = useHttp();
const res = await fetch({
  url: 'https://api.hubspot.com/crm/v3/objects/contacts',
  method: 'POST',
  headers: { Authorization: `Bearer ${myToken}` },   // your own bearer
  body: { properties: { email } },                   // object → JSON
});
const data = JSON.parse(res.body);                   // { status, headers, body }
```

```jsonc
// manifest scopes — the consented http allowlist
"scopes": ["http:api.hubspot.com", "http:*.googleapis.com"]
```

The proxy is HTTPS-only, SSRF-guarded, follows no redirects, and caps responses at 1 MB. An app can only reach the hosts it declared — even a bearer can't be exfiltrated elsewhere. It's also rate-limited per org and circuit-broken per host.

**Stored connections** — instead of carrying your own bearer, reference a connection the org set up; the platform injects the (auto-refreshed) credential **server-side**, so the secret never enters your code:

```tsx
await fetch({
  url: 'https://example.salesforce.com/services/data/v60.0/sobjects/Contact',
  method: 'POST',
  connection: 'salesforce',           // platform injects Authorization server-side
  body: { LastName: 'Doe' },
});
```

```jsonc
"scopes": ["http:*.salesforce.com", "connection:salesforce"]
```

**Backend identity** — if your app has its own server, `useSession().token()` mints a short-lived JWT (signed with your signing secret, `aud: app:<id>`). Verify it on your backend:

```ts
import { verifyAppToken } from 'telenow';
const claims = verifyAppToken(token, SIGNING_SECRET, 'my-app'); // { sub, org_id, role, … }
```

Needs the `session:token` scope.

## CLI — `telenow`

```bash
npx telenow app init my-app   # scaffold a new app folder ($schema wired for editor autocomplete)
npx telenow validate          # check telenow.app.json (runs the same checks the server does at upload)
npx telenow build             # validate, bundle the React UI, → <appId>-<version>.telenow.zip
```

**`telenow validate`** catches manifest mistakes at the keyboard instead of at upload: bad `id`/`version`, non-semver versions, duplicate object types, tools referencing undeclared objects, `object.update`/`object.delete` with a `match` field that isn't declared, `http` tools missing `base_url`, duplicate page ids, and unrecognised scopes. The scaffold's `"$schema"` also gives you autocomplete + inline validation in VS Code.

**`telenow build`** validates first, then bundles your React UI (with an **inline sourcemap** + preserved component names, so the in-dashboard error overlay and your browser DevTools show real `.tsx` file:line), inlines the README, collects screenshots, and writes the uploadable ZIP. Upload it in **Apps → Upload app zip** (private to your org) or **Publish to marketplace** for review.

## External apps (server-side)

Node 18+. Zero runtime dependencies.

```bash
npm install telenow
```

## Quickstart (Express)

```ts
import express from 'express';
import { verifySignature, DataClient, type ToolCallRequest, type EventRequest } from 'telenow';

const SIGNING_SECRET = process.env.TELENOW_SIGNING_SECRET!; // from the app's "signing secret" in the dashboard
const APP_KEY = process.env.TELENOW_APP_KEY!;               // a per-install app key you minted
const db = new DataClient('https://api.telenow.ai', APP_KEY);

const app = express();
// IMPORTANT: verify against the RAW body, so capture it before JSON parsing.
app.use(express.json({ verify: (req, _res, buf) => ((req as any).rawBody = buf) }));

// An agent tool call (manifest tool with handler.kind = "http").
app.post('/tools/book', async (req, res) => {
  if (!verifySignature(SIGNING_SECRET, (req as any).rawBody, req.header('x-telenow-signature'))) {
    return res.status(401).json({ error: 'bad signature' });
  }
  const { arguments: args, caller } = req.body as ToolCallRequest;
  const appt = await db.create('appointment', { phone: caller?.number, ...args });
  // Whatever you return goes straight back into the live conversation.
  res.json({ ok: true, id: appt.id });
});

// A post-call event (manifest event with handler.kind = "webhook").
app.post('/events', async (req, res) => {
  if (!verifySignature(SIGNING_SECRET, (req as any).rawBody, req.header('x-telenow-signature'))) {
    return res.status(401).end();
  }
  const evt = req.body as EventRequest;        // { event: "call.analyzed", appId, data: {...} }
  console.log('event', evt.event, evt.data);
  res.status(204).end();
});

app.listen(3000);
```

## Data API

```ts
const db = new DataClient('https://api.telenow.ai', process.env.TELENOW_APP_KEY!);

const { objects } = await db.list('appointment', { phone: '+919812345678' });
const created   = await db.create('appointment', { phone, slot_start, status: 'booked' });
const updated   = await db.update('appointment', created.id, { status: 'cancelled' });
await db.remove('appointment', created.id);
```

`list` filters are equality matches on stored fields. Records are scoped to your app in the installing org automatically.

## Manifest

Author `telenow.app.json` and publish it via the dashboard or the publish API. The manifest types are exported (`Manifest`, `ToolDef`, `ObjectDef`, `EventDef`, …) so you can type-check the file you ship.

| Tool `handler.kind` | Runs where |
| --- | --- |
| `object.create` / `object.query` / `object.update` | Telenow's runtime (declarative — no hosting) |
| `http` | your server (this SDK) |
| `sandbox` | Telenow's hardened JS sandbox (vetted apps) |

## Build

```bash
npm install
npm run build   # tsc → dist/
```
