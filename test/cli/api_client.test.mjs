/**
 * api_client.test.mjs — retries, Retry-After, redirects and error mapping of the HTTP client.
 *
 * Covers: a read is retried on 503 and succeeds; a write is sent once; 429 waits Retry-After
 * (through the injected sleep) but never longer than the cap; a redirect is refused and the
 * key never reaches the redirect target; statuses map to the documented exit codes.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { ApiClient } from '../../dist/cli/core/api_client.js';
import { GOOD_KEY, startMock } from './mock_server.mjs';

let mock;
let other;
before(async () => {
  mock = await startMock();
  other = await startMock();
});
after(async () => {
  await mock.close();
  await other.close();
});

function client(sleeps) {
  return new ApiClient({
    baseUrl: mock.url,
    apiKey: GOOD_KEY,
    userAgent: 'test',
    timeoutMs: 5000,
    fetch: (u, i) => fetch(u, i),
    sleep: async (ms) => sleeps.push(ms),
  });
}

function failTimes(n, status, headers = {}) {
  let left = n;
  return (req) => {
    if (left > 0 && req.path === '/api/v1/me') {
      left--;
      return { status, body: { success: false, error: 'busy' }, headers };
    }
    return undefined;
  };
}

test('a read is retried on 503 with growing waits, then succeeds', async () => {
  const sleeps = [];
  mock.state.respond = failTimes(2, 503);
  const res = await client(sleeps).get('/api/v1/me');
  mock.state.respond = undefined;
  assert.equal(res.status, 200);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0]);
});

test('a read gives up after the retries: exit 6', async () => {
  const sleeps = [];
  mock.state.respond = failTimes(10, 503);
  await assert.rejects(client(sleeps).get('/api/v1/me'), (e) => e.exitCode === 6 && e.status === 503);
  mock.state.respond = undefined;
  assert.equal(sleeps.length, 2);
});

test('a write is sent once, never retried', async () => {
  const sleeps = [];
  let seen = 0;
  mock.state.respond = (req) => {
    if (req.method === 'POST') {
      seen++;
      return { status: 503, body: { success: false, error: 'busy' } };
    }
    return undefined;
  };
  await assert.rejects(client(sleeps).send('POST', '/api/agents/prompt/validate', { body: {} }), (e) => e.exitCode === 6);
  mock.state.respond = undefined;
  assert.equal(seen, 1);
  assert.equal(sleeps.length, 0);
});

test('429 waits Retry-After; a wait past the cap is not slept, it is reported', async () => {
  let sleeps = [];
  mock.state.respond = failTimes(1, 429, { 'Retry-After': '2' });
  await client(sleeps).get('/api/v1/me');
  assert.deepEqual(sleeps, [2000]);
  sleeps = [];
  mock.state.respond = failTimes(1, 429, { 'Retry-After': '3600' });
  await assert.rejects(client(sleeps).get('/api/v1/me'), (e) => e.exitCode === 5 && e.details.retryAfter === '3600');
  mock.state.respond = undefined;
  assert.deepEqual(sleeps, []);
});

test('a redirect is refused and the key never reaches its target', async () => {
  mock.state.respond = (req) => (req.path === '/api/v1/me' ? { status: 302, body: {}, headers: { Location: `${other.url}/api/v1/me` } } : undefined);
  await assert.rejects(client([]).get('/api/v1/me'), (e) => e.exitCode === 1 && /redirect/.test(e.message));
  mock.state.respond = undefined;
  assert.equal(other.requests.length, 0);
});

test('statuses map to exit codes and keep the server fields', async () => {
  const c = client([]);
  await assert.rejects(c.get('/api/agents/missing'), (e) => e.exitCode === 3 && e.message === 'Agent not found or access denied');
  mock.state.respond = () => ({ status: 409, body: { success: false, error: 'stale', code: 'agent_version_conflict', currentVersion: 7 } });
  await assert.rejects(c.send('PUT', '/api/agents/x', { body: {} }), (e) => e.exitCode === 4 && e.code === 'agent_version_conflict' && e.details.currentVersion === 7);
  mock.state.respond = () => ({ status: 403, body: { success: false, error: 'read-only key' } });
  await assert.rejects(c.get('/api/agents'), (e) => e.exitCode === 2);
  mock.state.respond = undefined;
});

test('an unreachable server is exit 7 and names only the origin', async () => {
  const c = new ApiClient({
    baseUrl: 'http://127.0.0.1:9',
    apiKey: GOOD_KEY,
    userAgent: 'test',
    timeoutMs: 2000,
    fetch: (u, i) => fetch(u, i),
    sleep: async () => {},
  });
  await assert.rejects(c.get('/api/v1/me'), (e) => e.exitCode === 7 && !e.message.includes(GOOD_KEY) && e.message.includes('127.0.0.1:9'));
});
