/**
 * campaigns.test.mjs — campaign commands, the dialling paths above all.
 *
 * Covers: create makes a draft (no question), takes --window, warns about v1-only fields;
 * add-targets checks the file first (quotes, header, bad numbers — nothing sent), uploads CSV as
 * the `file` part, pushes JSON in batches of 1000 with counters added up and duplicates skipped on
 * a re-run, asks only when the people would be called now (running / completed), and names the
 * batch that failed; start asks and reads the status back (a completed campaign → exit 1, the
 * route's "started" notwithstanding); pause; cancel asks; calls pages; results follows the cursor
 * and 404s an unknown campaign (the route itself answers an empty list).
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
async function draft(name = 'Renewals') {
  const r = await sb.run(['campaigns', 'create', '--name', name, '--agent', 'a1', '--window', '09:00-18:00', '--timezone', 'Asia/Kolkata']);
  assert.equal(r.code, 0, r.err);
  return r.json.id;
}

test('create makes a draft without asking, with the window; v1-only fields are warned about', async () => {
  const id = await draft();
  const c = mock.state.campaigns[id];
  assert.equal(c.status, 'draft');
  assert.equal(c.start_time_local, '09:00');
  assert.equal(c.end_time_local, '18:00');
  const post = mock.requests.filter((q) => q.method === 'POST' && q.path === `/api/orgs/${ORG_ID}/campaigns`).at(-1);
  assert.ok(post.headers['idempotency-key']);
  const r = await sb.run(['campaigns', 'create', '--file', file('c.json', JSON.stringify({ name: 'X', agentId: 'a1', start: true, targets: [] }))]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /ignored by this route: start, targets/);
  let bad = await sb.run(['campaigns', 'create', '--name', 'Y', '--agent', 'a1', '--window', '9-5']);
  assert.equal(bad.code, 1);
  bad = await sb.run(['campaigns', 'create', '--agent', 'a1']);
  assert.equal(bad.code, 1);
});

test('add-targets checks the file before sending anything', async () => {
  const id = await draft();
  const n = mock.requests.length;
  for (const [name, text] of [
    ['q.csv', 'phone_number,name\n+919876543210,"Rao, A"\n'],
    ['h.csv', 'mobile,name\n+919876543210,A\n'],
    ['b.csv', 'phone_number,name\n+919876543210,A\n98765,B\n'],
    ['e.csv', 'phone_number\n'],
    ['b.json', JSON.stringify([{ phoneNumber: '12' }])],
    ['x.txt', '+919876543210\n'],
  ]) {
    const r = await sb.run(['campaigns', 'add-targets', id, '--file', file(name, text)]);
    assert.equal(r.code, 1, name);
  }
  const r = await sb.run(['campaigns', 'add-targets', id, '--file', file('b2.csv', 'phone_number,name\n+919876543210,A\n98765,B\n')]);
  assert.deepEqual(r.errors[0].error.badLines, [3]);
  assert.equal(mock.requests.length, n);
});

test('CSV goes up as the "file" part; a draft does not ask', async () => {
  const id = await draft();
  const r = await sb.run(['campaigns', 'add-targets', id, '--file', file('p.csv', 'phone_number,name\n+919876543210,Asha\n+919876543211,Ravi\n')]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { added: 2, suppressed: 0 });
  const up = mock.requests.filter((q) => q.path === `/api/orgs/${ORG_ID}/campaigns/${id}/targets`).at(-1);
  assert.match(up.headers['content-type'], /^multipart\/form-data/);
  assert.equal(up.headers['idempotency-key'], undefined, 'uploads go without the key');
  assert.match(up.body, /name="file"; filename="p.csv"/);
  assert.match(up.body, /\+919876543211,Ravi/);
});

test('JSON goes to v1 in batches of 1000; counters add up; a re-run skips the ids as duplicates', async () => {
  const id = await draft();
  const rows = Array.from({ length: 1001 }, (_, i) => ({ phoneNumber: `+9198765${String(i).padStart(5, '0')}`, id: `p${i}` }));
  const f = file('people.json', JSON.stringify(rows));
  let r = await sb.run(['campaigns', 'add-targets', id, '--file', f, '--source', 'crm']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.requests, 2);
  assert.equal(r.json.added, 1001);
  const pushes = mock.requests.filter((q) => q.path === `/api/v1/campaigns/${id}/targets`);
  assert.deepEqual(pushes.map((q) => q.body.targets.length), [1000, 1]);
  assert.equal(pushes[0].body.source, 'crm');
  r = await sb.run(['campaigns', 'add-targets', id, '--file', f, '--source', 'crm']);
  assert.equal(r.json.added, 0);
  assert.equal(r.json.duplicates, 1001);
});

test('a failed later batch says how many went in and whether a re-run is safe', async () => {
  const id = await draft();
  const rows = Array.from({ length: 1500 }, (_, i) => ({ phoneNumber: `+9198700${String(i).padStart(5, '0')}`, id: `f${i}` }));
  mock.state.failPushAfter = 1;
  mock.state.pushes = 0;
  const r = await sb.run(['campaigns', 'add-targets', id, '--file', file('f.json', JSON.stringify(rows))]);
  mock.state.failPushAfter = undefined;
  assert.equal(r.code, 6);
  assert.match(r.errors[0].error.message, /batch 2 of 2 failed; the 1 before it were added/);
  assert.match(r.errors[0].error.message, /re-running the same command adds nobody twice/);
  assert.equal(r.errors[0].error.addedSoFar.added, 1000);
});

test('adding to a running campaign asks (they would be called now); --yes goes ahead', async () => {
  const id = await draft();
  mock.state.campaigns[id].status = 'running';
  const f = file('r.json', JSON.stringify([{ phoneNumber: '+919811111111' }]));
  let r = await sb.run(['campaigns', 'add-targets', id, '--file', f]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /will be called/);
  mock.state.campaigns[id].status = 'completed';
  r = await sb.run(['campaigns', 'add-targets', id, '--file', f]);
  assert.match(r.errors[0].error.message, /reopens the campaign/);
  r = await sb.run(['campaigns', 'add-targets', id, '--file', f, '--yes']);
  assert.equal(r.code, 0, r.err);
});

test('start asks, then reads the status back', async () => {
  const id = await draft('Start me');
  let r = await sb.run(['campaigns', 'start', id]);
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /Start campaign "Start me"/);
  assert.equal(mock.state.campaigns[id].status, 'draft');
  r = await sb.run(['campaigns', 'start', id, '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.status, 'running');
  mock.state.campaigns[id].status = 'completed';
  r = await sb.run(['campaigns', 'start', id, '--yes']);
  assert.equal(r.code, 1, 'the route says "started" but nothing changed');
  assert.equal(r.errors[0].error.code, 'campaign_status_unchanged');
  assert.equal(r.errors[0].error.status, 'completed');
});

test('pause does not ask; cancel asks', async () => {
  const id = await draft();
  mock.state.campaigns[id].status = 'running';
  let r = await sb.run(['campaigns', 'pause', id]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.status, 'paused');
  r = await sb.run(['campaigns', 'cancel', id]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'needs_yes');
  r = await sb.run(['campaigns', 'cancel', id, '--yes']);
  assert.equal(r.json.status, 'cancelled');
});

test('calls pages with status counts; results follows the cursor; unknown campaign is exit 3', async () => {
  const id = await draft();
  mock.state.campaignCalls = { [id]: Array.from({ length: 5 }, (_, i) => ({ id: `cc${i}`, phone_number: `+9190000000${i}`, status: 'completed', payload: 1 })) };
  let r = await sb.run(['campaigns', 'calls', id, '--limit', '2']);
  assert.equal(r.json.length, 2);
  assert.ok(!('payload' in r.json[0]));
  assert.ok(r.errors.some((n) => n.statusCounts));
  r = await sb.run(['campaigns', 'calls', id, '--limit', '2', '--all', '--quiet']);
  assert.equal(r.json.length, 5);
  mock.state.results = { [id]: Array.from({ length: 5 }, (_, i) => ({ callId: `c${i}`, outcome: 'answered' })) };
  r = await sb.run(['campaigns', 'results', id, '--limit', '2']);
  assert.equal(r.json.length, 2);
  assert.deepEqual(r.errors[0], { more: { nextCursor: '2' } });
  r = await sb.run(['campaigns', 'results', id, '--limit', '2', '--all']);
  assert.equal(r.json.length, 5);
  r = await sb.run(['campaigns', 'results', 'k9999999-0000-4000-8000-000000000000']);
  assert.equal(r.code, 3);
});
