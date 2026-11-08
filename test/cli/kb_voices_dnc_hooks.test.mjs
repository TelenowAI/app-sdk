/**
 * kb_voices_dnc_hooks.test.mjs — knowledge bases, voices, do-not-call, webhooks, analytics.
 *
 * Covers: kb create / add-doc (file as the `file` part with `title`; https-only url; text file
 * needs a title; exactly one source) / docs / attach / detach / delete (asks); a server without
 * the Knowledge module says so (exit 3, `knowledge_module_off`); voices filtered here by language
 * prefix, gender and limit, the fallback said on stderr; dnc add (E.164) / import (the `file`
 * part) / list / remove (asks); webhooks create checks each event with the server's own list
 * first (unknown → exit 1, nothing created) and says the secret is shown once; disable refuses an
 * id the list does not hold (the route would say "disabled" anyway); test; deliveries' short view
 * drops payloads; analytics checks its days.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { GOOD_KEY, ORG_ID, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

let mock;
let sb;
before(async () => {
  mock = await startMock();
  sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
});
after(async () => {
  sb.cleanup();
  await mock.close();
});
const file = (name, text) => {
  const p = join(sb.home, name);
  writeFileSync(p, text);
  return p;
};
const last = (path) => mock.requests.filter((q) => q.path === path).at(-1);

test('knowledge base: create, add a file / url / text, docs, attach, detach, delete', async () => {
  let r = await sb.run(['kb', 'create', '--name', 'Pricing']);
  assert.equal(r.code, 0, r.err);
  const kb = r.json.id;
  const base = `/api/orgs/${ORG_ID}/knowledge-bases/${kb}/documents`;
  r = await sb.run(['kb', 'add-doc', kb, '--file', file('plans.md', '# Plans\nGold: 999'), '--title', 'Plans']);
  assert.equal(r.code, 0, r.err);
  const up = last(`${base}/upload`);
  assert.match(up.body, /name="title"\r\n\r\nPlans/);
  assert.match(up.body, /name="file"; filename="plans.md"/);
  r = await sb.run(['kb', 'add-doc', kb, '--url', 'https://example.com/faq']);
  assert.deepEqual(last(`${base}/url`).body, { url: 'https://example.com/faq' });
  r = await sb.run(['kb', 'add-doc', kb, '--text-file', file('t.txt', 'Hours: 9-5'), '--title', 'Hours']);
  assert.deepEqual(last(base).body, { title: 'Hours', body: 'Hours: 9-5' });
  for (const bad of [['--url', 'http://example.com'], ['--text-file', file('u.txt', 'x')], [], ['--url', 'https://a.b', '--file', 'x']]) {
    r = await sb.run(['kb', 'add-doc', kb, ...bad]);
    assert.equal(r.code, 1, bad.join(' '));
  }
  r = await sb.run(['kb', 'docs', kb]);
  assert.deepEqual(r.json.map((d) => d.status), ['pending', 'pending', 'pending']);
  r = await sb.run(['kb', 'attach', kb, '--agent', 'agent1']);
  assert.equal(r.code, 0, r.err);
  assert.ok(mock.state.attached.has(`agent1|${kb}`));
  r = await sb.run(['kb', 'detach', kb, '--agent', 'agent1']);
  assert.ok(!mock.state.attached.has(`agent1|${kb}`));
  r = await sb.run(['kb', 'delete', kb]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /"Pricing", 3 documents/);
  r = await sb.run(['kb', 'delete', kb, '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(mock.state.kbs[kb], undefined);
});

test('a file upload goes without an Idempotency-Key, so a file over 5 MiB is accepted', async () => {
  let r = await sb.run(['kb', 'create', '--name', 'Big']);
  const kb = r.json.id;
  const big = file('big.txt', 'x'.repeat(6 * 1024 * 1024));
  r = await sb.run(['kb', 'add-doc', kb, '--file', big]);
  assert.equal(r.code, 0, r.err);
  assert.ok(!('body' in r.json), 'the document text is not echoed back');
  assert.ok(r.out.length < 1000, `a short answer, not the ${r.out.length}-byte document`);
  const up = last(`/api/orgs/${ORG_ID}/knowledge-bases/${kb}/documents/upload`);
  assert.equal(up.headers['idempotency-key'], undefined);
  assert.ok(up.bytes > 6 * 1024 * 1024);
  r = await sb.run(['kb', 'add-doc', kb, '--file', big, '--idempotency-key', 'upload-key-0001']);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /cannot be used with a file upload/);
  r = await sb.run(['kb', 'add-doc', kb, '--url', 'https://example.com/a']);
  assert.ok(last(`/api/orgs/${ORG_ID}/knowledge-bases/${kb}/documents/url`).headers['idempotency-key'], 'a JSON add still carries the key');
  r = await sb.run(['dnc', 'import', '--file', file('k.csv', '+919876500009\n')]);
  assert.equal(last(`/api/orgs/${ORG_ID}/dnc/import`).headers['idempotency-key'], undefined);
});

test('a server without the Knowledge module says so', async () => {
  mock.state.knowledgeOff = true;
  const r = await sb.run(['kb', 'list']);
  mock.state.knowledgeOff = false;
  assert.equal(r.code, 3);
  assert.equal(r.errors[0].error.code, 'knowledge_module_off');
});

test('voices: filtered here by language prefix, gender and limit; a fallback is said', async () => {
  mock.state.voices = {
    elevenlabs: [
      { id: 'v1', name: 'Asha', language: 'hi-IN', gender: 'female', preview_url: 'p1', tags: ['x'] },
      { id: 'v2', name: 'Ravi', language: 'en', languages: ['hi', 'en'], gender: 'male' },
      { id: 'v3', name: 'Meera', language: 'Hindi', gender: 'Female' },
      { id: 'v4', name: 'Kate', language: 'en-GB', gender: 'female' },
    ],
  };
  let r = await sb.run(['voices', 'list', '--provider', 'elevenlabs', '--language', 'hi']);
  assert.deepEqual(r.json.map((v) => v.id), ['v1', 'v2']);
  assert.ok(!('tags' in r.json[0]));
  r = await sb.run(['voices', 'list', '--provider', 'elevenlabs', '--language', 'hindi', '--gender', 'female']);
  assert.deepEqual(r.json.map((v) => v.id), ['v3']);
  r = await sb.run(['voices', 'list', '--provider', 'elevenlabs', '--gender', 'female', '--limit', '2']);
  assert.deepEqual(r.json.map((v) => v.id), ['v1', 'v3']);
  r = await sb.run(['voices', 'list', '--provider', 'nobody']);
  assert.deepEqual(r.json, []);
  assert.match(r.err, /fallback/);
  r = await sb.run(['voices', 'list']);
  assert.equal(r.code, 1);
  r = await sb.run(['voices', 'list', '--provider', '../x']);
  assert.equal(r.code, 1);
});

test('do-not-call: add (E.164), import (file part), list, remove asks', async () => {
  let r = await sb.run(['dnc', 'add', '+91 98765 00001', '--reason', 'asked']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(last(`/api/orgs/${ORG_ID}/dnc`).body, { phoneNumber: '+919876500001', reason: 'asked' });
  r = await sb.run(['dnc', 'add', '98765']);
  assert.equal(r.code, 1);
  r = await sb.run(['dnc', 'import', '--file', file('n.csv', '+919876500002\n+919876500003,opted out\n')]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.added, 2);
  assert.match(last(`/api/orgs/${ORG_ID}/dnc/import`).body, /name="file"; filename="n.csv"/);
  r = await sb.run(['dnc', 'list', '--search', '00001']);
  assert.equal(r.json.length, 1);
  const id = r.json[0].id;
  r = await sb.run(['dnc', 'remove', id]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /can be called again/);
  r = await sb.run(['dnc', 'remove', id, '--yes']);
  assert.equal(r.code, 0, r.err);
  r = await sb.run(['dnc', 'remove', id, '--yes']);
  assert.equal(r.code, 3, 'a repeat is a 404');
});

test("webhooks: events checked with the server's list first; secret note; disable refuses an unknown id", async () => {
  const n = Object.keys(mock.state.hooks2 ?? {}).length;
  let r = await sb.run(['webhooks', 'create', '--url', 'https://example.com/hook', '--events', 'call.completed,call.finished']);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'unknown_event');
  assert.match(r.errors[0].error.message, /valid: call.completed/);
  assert.equal(Object.keys(mock.state.hooks2 ?? {}).length, n, 'nothing created');
  r = await sb.run(['webhooks', 'create', '--url', 'http://example.com/hook']);
  assert.equal(r.code, 1);
  r = await sb.run(['webhooks', 'create', '--url', 'https://example.com/hook', '--events', 'call.completed']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.signing_secret, 'wh_secret_test_only');
  assert.match(r.err, /shown only now/);
  const id = r.json.endpoint.id;
  r = await sb.run(['webhooks', 'test', id, '--event', 'call.completed']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(last(`/api/orgs/${ORG_ID}/webhooks/${id}/test`).body, { eventType: 'call.completed' });
  r = await sb.run(['webhooks', 'deliveries', id]);
  assert.ok(!('payload' in r.json[0]));
  r = await sb.run(['webhooks', 'disable', 'w0000000-0000-4000-8000-000000000999', '--yes']);
  assert.equal(r.code, 3, 'the route would answer "disabled" for any id');
  r = await sb.run(['webhooks', 'disable', id]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /https:\/\/example.com\/hook/);
  r = await sb.run(['webhooks', 'disable', id, '--yes']);
  assert.equal(r.code, 0, r.err);
  r = await sb.run(['webhooks', 'list']);
  assert.ok(!r.json.some((h) => h.id === id));
});

test('analytics checks its days', async () => {
  let r = await sb.run(['analytics', '--from', '2026-11-01', '--to', '2026-11-07']);
  assert.equal(r.code, 0, r.err);
  assert.equal(last(`/api/orgs/${ORG_ID}/analytics`).query.from, '2026-11-01');
  r = await sb.run(['analytics', '--from', '1 Nov']);
  assert.equal(r.code, 1);
});
