/**
 * browser_login.test.mjs — `telenow login` with no key option: the device-code browser sign-in.
 *
 * Covers: the whole flow (start without a key, the code and link on stderr, the link opened,
 * polls every `interval`, the new key checked with /api/v1/me and saved like --key-stdin plus
 * keyId and expiresAt, the same printed data, the expiry note); the same flow approved through
 * the approval page's own routes while the CLI waits (what the page shows, a role too high
 * refused, the chosen org/role/name saved, a second approval refused); the device code and the new key
 * never on stdout/stderr, in a URL or in the opened link; `--no-browser`; an opener that fails;
 * `slow_down`; denial; the server's `expired_token`; stopping at `expiresIn` by itself; a 503 and
 * a 429 ridden out, three 503s not; a server older than browser login (404) falling back to the
 * key prompt, or explaining itself with no terminal; `--key` and `--key-stdin` not starting a
 * browser login; hostile answers (a `file:` link, a code with escape characters) refused before
 * anything is opened; a minted key that fails its check named in the error; no SIGINT listener
 * left behind; and Ctrl-C in a real process: exit 1 `cancelled` at once, nothing saved.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeCliLoginState } from './mock_cli_login.mjs';
import { GOOD_KEY, ORG_ID, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const BIN = fileURLToPath(new URL('../../bin/telenow.mjs', import.meta.url));
let mock;
let from;
before(async () => {
  mock = await startMock();
});
after(async () => {
  await mock.close();
});
beforeEach(() => {
  mock.state.cliLogin = makeCliLoginState();
  from = mock.requests.length;
});
const since = () => mock.requests.slice(from);
const polls = () => since().filter((r) => r.path === '/api/cli-login/token');
const starts = () => since().filter((r) => r.path === '/api/cli-login/start');
const deviceCodes = () => Object.keys(mock.state.cliLogin.requests);
const linkFor = (code = 'WDJB-MJHT') => `${mock.url}/cli/authorize?code=${code}`;

test('login with no option: start, show the code and link, open it, poll, then save the new key like --key-stdin', async () => {
  const sb = makeSandbox(mock.url);
  const ks = await sb.run(['login', '--key-stdin', '--profile', 'pasted'], { stdin: GOOD_KEY });
  assert.equal(ks.code, 0, ks.err);
  from = mock.requests.length;
  mock.state.cliLogin.answers = ['pending', 'pending', 'approve'];
  // No terminal: the AI-assistant case. The link is printed (and, here, opened).
  const r = await sb.run(['login', '--profile', 'default']);
  assert.equal(r.code, 0, r.err);

  const [start] = starts();
  assert.deepEqual(Object.keys(start.body).sort(), ['cliVersion', 'hostname', 'os']);
  assert.equal(start.body.hostname, hostname());
  assert.match(start.body.cliVersion, /^\d+\.\d+\.\d+/);
  assert.equal(start.headers['x-api-key'], undefined, 'start takes no key');

  assert.match(r.err, /approve the code WDJB-MJHT/);
  assert.ok(r.err.includes(`\n  ${linkFor()}\n`), r.err);
  assert.deepEqual(sb.opened, [linkFor()]);
  assert.match(r.err, /Opened it in your browser/);

  assert.equal(polls().length, 3);
  for (const p of polls()) {
    assert.equal(p.headers['x-api-key'], undefined, 'token takes no key');
    assert.deepEqual(p.body, { deviceCode: deviceCodes()[0] });
    assert.deepEqual(p.query, {});
  }
  assert.deepEqual(sb.sleeps, [5000, 5000, 5000], 'one wait of `interval` before every poll');

  const minted = mock.state.cliLogin.minted[0];
  const me = since().at(-1);
  assert.equal(me.path, '/api/v1/me', 'the new key is checked like a pasted one');
  assert.equal(me.headers['x-api-key'], minted.apiKey);
  const saved = JSON.parse(readFileSync(sb.configFile, 'utf8'));
  const p = saved.profiles.default;
  assert.equal(saved.currentProfile, 'default');
  assert.equal(p.apiKey, minted.apiKey);
  assert.equal(p.baseUrl, mock.url);
  assert.equal(p.orgId, ORG_ID);
  assert.equal(p.orgName, 'Acme');
  assert.equal(p.keyRole, 'developer');
  assert.match(p.keyName, /^telenow CLI — /);
  assert.equal(p.keyId, minted.keyId);
  assert.ok(Date.parse(p.expiresAt) > Date.now() + 80 * 24 * 3600 * 1000, p.expiresAt);
  assert.deepEqual(
    Object.keys(p).sort(),
    [...Object.keys(saved.profiles.pasted), 'keyId', 'expiresAt'].sort(),
    'saved exactly as --key-stdin saves, plus keyId and expiresAt',
  );
  assert.equal(statSync(sb.configFile).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(r.json).sort(), Object.keys(ks.json).sort(), 'prints the same data as --key-stdin');
  assert.equal(r.json.profile, 'default');
  assert.equal(r.json.keyRole, 'developer');
  const note = r.errors.find((e) => e && typeof e === 'object' && e.note);
  assert.match(note.note, /^this login expires on \d{4}-\d{2}-\d{2}; then run `telenow login` again$/);
  assert.equal(note.expiresAt, p.expiresAt);
  sb.cleanup();
});

test("approved on the page's routes while the CLI waits: the role and name chosen there are what is saved", async () => {
  const sb = makeSandbox(mock.url);
  const page = (path, body) =>
    fetch(`${mock.url}/api/cli-login/requests/WDJB-MJHT${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer person-token', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
  const seen = {};
  const r = await sb.run(['login'], {
    // The person opens the link and approves while the CLI sits in its second wait.
    onSleep: async (_ms, n) => {
      if (n !== 2) return;
      seen.shown = await page('');
      seen.tooHigh = await page('/approve', { orgId: ORG_ID, role: 'admin' });
      seen.ok = await page('/approve', { orgId: ORG_ID, role: 'viewer', name: 'my laptop' });
      seen.again = await page('/approve', { orgId: ORG_ID, role: 'viewer' });
    },
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(seen.shown.status, 200);
  const shown = seen.shown.body.data;
  assert.equal(shown.userCode, 'WDJB-MJHT');
  assert.equal(shown.hostname, hostname());
  assert.deepEqual(shown.orgs.map((o) => [o.id, o.maxKeyRole]), [[ORG_ID, 'developer']]);
  assert.equal(seen.tooHigh.status, 403);
  assert.equal(seen.tooHigh.body.code, 'cli_login_role_too_high');
  assert.deepEqual(seen.ok, { status: 200, body: { success: true, data: { orgId: ORG_ID, role: 'viewer' } } });
  assert.equal(seen.again.status, 409);
  assert.equal(seen.again.body.code, 'cli_login_decided');
  assert.equal(polls().length, 2, 'pending at the first poll, the key at the second');
  assert.equal(r.json.keyRole, 'viewer');
  assert.equal(r.json.keyName, 'my laptop');
  const p = JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles.default;
  assert.equal(p.keyRole, 'viewer');
  assert.equal(p.apiKey, mock.state.cliLogin.minted[0].apiKey);
  sb.cleanup();
});

test('the device code and the new key never reach stdout, stderr, a URL or the opened link', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['pending', 'slow_down', 'http503', 'approve'];
  let r = await sb.run(['login']);
  assert.equal(r.code, 0, r.err);
  mock.state.cliLogin.answers = ['deny'];
  const denied = await sb.run(['login', '--profile', 'other']);
  assert.equal(denied.code, 2);
  const secrets = [...deviceCodes(), ...mock.state.cliLogin.minted.map((m) => m.apiKey)];
  assert.equal(deviceCodes().length, 2);
  for (const s of secrets) {
    for (const out of [r.out, r.err, denied.out, denied.err]) assert.ok(!out.includes(s), `printed: ${s}`);
    for (const q of since()) assert.ok(!(q.path + JSON.stringify(q.query)).includes(s), `in a URL: ${q.path}`);
    for (const u of sb.opened) assert.ok(!u.includes(s), `in the opened link: ${u}`);
  }
  for (const q of since()) {
    const carries = JSON.stringify(q.body ?? '').includes('dc_secret_');
    assert.equal(carries, q.path === '/api/cli-login/token', `device code in the body of ${q.path}`);
  }
  sb.cleanup();
});

test('--no-browser prints the link and opens nothing', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['approve'];
  const r = await sb.run(['login', '--no-browser']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sb.opened, []);
  assert.ok(r.err.includes(linkFor()));
  assert.doesNotMatch(r.err, /Opened it|not opened/);
  sb.cleanup();
});

test('an opener that cannot open says why, and the printed link still signs in', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['approve'];
  const r = await sb.run(['login'], { openUrl: async () => ({ opened: false, reason: 'there is no graphical display here' }) });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /The link was not opened here \(there is no graphical display here\); open it in a browser on any device/);
  sb.cleanup();
});

test('slow_down adds 5 seconds to this and every later poll', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['pending', 'slow_down', 'pending', 'slow_down', 'approve'];
  const r = await sb.run(['login']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sb.sleeps, [5000, 5000, 10000, 10000, 15000]);
  assert.equal(polls().length, 5);
  sb.cleanup();
});

test('denied in the browser: exit 2 access_denied, polling stops, nothing saved', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['pending', 'deny'];
  const r = await sb.run(['login']);
  assert.equal(r.code, 2);
  const e = r.errors.at(-1).error;
  assert.equal(e.code, 'access_denied');
  assert.match(e.message, /denied in the browser/);
  assert.equal(polls().length, 2);
  assert.equal(existsSync(sb.configFile), false);
  sb.cleanup();
});

test("the server's expired_token: exit 2, nothing saved", async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['pending', 'expired_token'];
  const r = await sb.run(['login']);
  assert.equal(r.code, 2);
  assert.equal(r.errors.at(-1).error.code, 'expired_token');
  assert.match(r.errors.at(-1).error.message, /expired or was already used; run `telenow login` again/);
  assert.equal(existsSync(sb.configFile), false);
  sb.cleanup();
});

test('it stops by itself at expiresIn, without waiting for the server to say so', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.expiresIn = 12;
  const r = await sb.run(['login']);
  assert.equal(r.code, 2);
  const e = r.errors.at(-1).error;
  assert.equal(e.code, 'expired_token');
  assert.match(e.message, /not approved within 12 seconds/);
  assert.equal(polls().length, 2, 'polls at 5 s and 10 s; stops at 15 s >= 12 s');
  assert.deepEqual(sb.sleeps, [5000, 5000, 5000]);
  assert.match(r.err, /the code expires in 12 seconds; Ctrl-C cancels/);
  assert.equal(existsSync(sb.configFile), false);
  sb.cleanup();
});

test('a 503 and a 429 (Retry-After) are ridden out; three 503s in a row are not', async () => {
  let sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = [
    'http503',
    { status: 429, body: { success: false, error: 'Too many requests' }, headers: { 'Retry-After': '7' } },
    'pending',
    'approve',
  ];
  let r = await sb.run(['login']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(sb.sleeps, [5000, 5000, 7000, 5000]);
  sb.cleanup();

  sb = makeSandbox(mock.url);
  mock.state.cliLogin = makeCliLoginState();
  from = mock.requests.length;
  mock.state.cliLogin.answers = ['http503', 'http503', 'http503'];
  r = await sb.run(['login']);
  assert.equal(r.code, 6);
  assert.equal(polls().length, 3);
  assert.equal(existsSync(sb.configFile), false);
  sb.cleanup();
});

test('expired_token after a lost answer says the key may exist and how to find it', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['http503', 'expired_token'];
  const r = await sb.run(['login']);
  assert.equal(r.code, 2);
  assert.match(r.errors.at(-1).error.message, /answer was lost.*"telenow CLI" key in the dashboard/);
  sb.cleanup();
});

test('a server older than browser login (404): no terminal → says so and what to do; a terminal → the key prompt', async () => {
  mock.state.cliLogin.routes = false;
  let sb = makeSandbox(mock.url);
  let r = await sb.run(['login']);
  assert.equal(r.code, 1);
  const e = r.errors.at(-1).error;
  assert.equal(e.code, 'browser_login_unavailable');
  assert.match(e.message, /does not offer browser sign-in yet \(the server is older\): pipe an org API key in with `--key-stdin`/);
  assert.equal(starts().length, 1);
  assert.equal(polls().length, 0);
  assert.equal(existsSync(sb.configFile), false);
  sb.cleanup();

  sb = makeSandbox(mock.url);
  r = await sb.run(['login'], { tty: true, stdin: GOOD_KEY + '\n' });
  assert.equal(r.code, 0, r.err);
  const lines = r.err.split('\n');
  assert.ok(lines.includes(`${mock.url} does not offer browser sign-in yet (the server is older); paste an org API key instead.`), r.err);
  assert.equal(JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles.default.apiKey, GOOD_KEY);
  assert.deepEqual(sb.opened, []);
  sb.cleanup();
});

test('--key asks for a pasted key and --key-stdin reads one: neither starts a browser login', async () => {
  const sb = makeSandbox(mock.url);
  let r = await sb.run(['login', '--key'], { tty: true, stdin: GOOD_KEY + '\n' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /^API key for /);
  r = await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
  assert.equal(r.code, 0, r.err);
  assert.equal(starts().length, 0);
  assert.deepEqual(sb.opened, []);
  const p = JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles.default;
  assert.equal(p.keyId, undefined);
  assert.equal(p.expiresAt, undefined);
  sb.cleanup();
});

test('hostile start answers are refused before anything is opened or printed', async () => {
  for (const link of ['file:///etc/passwd', 'javascript:alert(1)', '/Applications/Calculator.app', 'http://evil.example/cli/authorize']) {
    mock.state.cliLogin = makeCliLoginState();
    mock.state.cliLogin.linkBase = link;
    const sb = makeSandbox(mock.url);
    const r = await sb.run(['login']);
    assert.equal(r.code, 6, `${link}: ${r.err}`);
    assert.match(r.errors.at(-1).error.message, /has no https:\/\/ verificationUri/);
    assert.deepEqual(sb.opened, []);
    assert.ok(!r.err.includes(link), `${link} printed`);
    sb.cleanup();
  }
  mock.state.cliLogin = makeCliLoginState();
  mock.state.cliLogin.userCode = 'AB\u001b[2JCD';
  const sb = makeSandbox(mock.url);
  const r = await sb.run(['login']);
  assert.equal(r.code, 6);
  assert.match(r.errors.at(-1).error.message, /usable userCode/);
  assert.ok(!r.err.includes('\u001b'), 'no escape sequence reaches the terminal');
  assert.deepEqual(sb.opened, []);
  sb.cleanup();
});

test('a new key that fails its check is named in the error, so it can be revoked; nothing saved', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['approve'];
  mock.state.cliLogin.mint.expired = true;
  const r = await sb.run(['login']);
  assert.equal(r.code, 2);
  const e = r.errors.at(-1).error;
  assert.match(e.message, /^the server made the key 'telenow CLI — .+', but checking it failed \(This API key has expired\); nothing was saved/);
  assert.equal(e.keyId, mock.state.cliLogin.minted[0].keyId);
  assert.equal(existsSync(sb.configFile), false);
  sb.cleanup();
});

test('a key without an expiry is saved without one, and no expiry note is printed', async () => {
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['approve'];
  mock.state.cliLogin.mint.expiresInDays = null;
  const r = await sb.run(['login']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(readFileSync(sb.configFile, 'utf8')).profiles.default.expiresAt, undefined);
  assert.ok(!r.errors.some((e) => e && typeof e === 'object' && e.note));
  sb.cleanup();
});

test('no SIGINT listener is left behind, whether the login succeeds or fails', async () => {
  const n = process.listenerCount('SIGINT');
  const sb = makeSandbox(mock.url);
  mock.state.cliLogin.answers = ['approve'];
  assert.equal((await sb.run(['login'])).code, 0);
  mock.state.cliLogin.answers = ['deny'];
  assert.equal((await sb.run(['login'])).code, 2);
  assert.equal(process.listenerCount('SIGINT'), n);
  sb.cleanup();
});

test('Ctrl-C while waiting (a real process): exit 1 cancelled, at once, nothing saved', async () => {
  // A long interval: if the wait were not cancelled, the process would sit out the whole 60 s.
  mock.state.cliLogin.interval = 60;
  const home = mkdtempSync(join(tmpdir(), 'telenow-ctrlc-test-'));
  const cfg = join(home, 'cfg.json');
  const child = spawn(process.execPath, [BIN, 'login', '--no-browser'], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, TELENOW_CONFIG: cfg, TELENOW_BASE_URL: mock.url },
  });
  let err = '';
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => {
    child.stderr.on('data', (d) => {
      err += d;
      if (err.includes('Ctrl-C cancels')) resolve();
    });
    child.on('close', () => reject(new Error(`exited before waiting: ${err}`)));
  });
  const t0 = Date.now();
  child.kill('SIGINT');
  const { code, signal } = await exited;
  const tookMs = Date.now() - t0;
  assert.equal(signal, null, `killed by ${signal} instead of exiting`);
  assert.equal(code, 1, err);
  const last = JSON.parse(err.trim().split('\n').at(-1));
  assert.equal(last.error.code, 'cancelled');
  assert.match(last.error.message, /nothing was saved/);
  assert.ok(tookMs < 15_000, `took ${tookMs} ms to exit after Ctrl-C (interval 60 s)`);
  assert.equal(out, '');
  assert.equal(existsSync(cfg), false);
  assert.equal(polls().length, 0);
  rmSync(home, { recursive: true, force: true });
});
