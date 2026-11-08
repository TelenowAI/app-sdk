/**
 * chat.test.mjs — phase 4b: talking to an agent by text (`telenow chat …`, the Chat API).
 *
 * Covers:
 * - chat send: the reply; a new session ENDED after it unless --keep; --session continues and keeps
 *   it open, --end ends it; the request's names; an Idempotency-Key; the identifier (stable per
 *   key, not the key, different for another key, --identifier wins); --var on the first turn
 *   only; the refusals the server sends (410, 409, 403) carry what to do; options in `ui` and
 *   --option; the reply kept when ending fails; --dry-run reads and sends nothing.
 * - An agent that can phone people from a chat (`followup.enabled` AND `.chat`) needs a yes
 *   (exit 1 needs_yes without a terminal, and nothing is sent); other shapes do not ask; its own
 *   tools are named.
 * - chat messages (JSON and text); chat end (idempotent; a phone call's id is refused).
 * - chat <agent-id> in a terminal:
 *   - refuses without a terminal;
 *   - turns one per line, and a number picks an option;
 *   - the session is ended on /end, at end of input, and on Ctrl-C (which drops the reply in
 *     flight);
 *   - a session the server ended (410) carries on in a new one;
 *   - the yes answer and the first message read from ONE reader (a paste);
 *   - no SIGINT listener is left behind.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { GOOD_KEY, ORG_ID, agentRow, startMock } from './mock_server.mjs';
import { makeSandbox } from './run_cli.mjs';

const AGENT = 'a0000000-0000-4000-8000-0000000000c1';
const DIALER = 'a0000000-0000-4000-8000-0000000000c2';
const OTHER_KEY = 'vai_live_test_other_key';
let mock;
let sb;
before(async () => {
  mock = await startMock();
  mock.state.keys[OTHER_KEY] = { org_id: ORG_ID, org_name: 'Acme', key_id: 'k9', key_name: 'other', key_role: 'viewer', parent_org_id: null };
  sb = makeSandbox(mock.url);
  await sb.run(['login', '--key-stdin'], { stdin: GOOD_KEY });
});
after(async () => {
  sb.cleanup();
  await mock.close();
});
beforeEach(() => {
  const s = mock.state;
  s.agents = {
    [AGENT]: agentRow(AGENT, { name: 'Helper', session_config: {}, metadata: { tools: [{ name: 'lookup_order' }, { name: 'book_slot' }] } }),
    [DIALER]: agentRow(DIALER, { name: 'Caller', session_config: { followup: { enabled: true, chat: true } }, metadata: {} }),
  };
  s.chats = {};
  s.chatIdem = {};
  s.chatBusy = false;
  s.chatExpire = false;
  s.chatDelayMs = 0;
  s.onChatTurn = undefined;
  s.chatReply = undefined;
  s.voiceSessions = [];
  s.respond = undefined;
  mock.requests.length = 0;
});

const turns = () => mock.requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/chat');
const ends = () => mock.requests.filter((r) => r.method === 'POST' && /\/api\/v1\/chat\/[^/]+\/end$/.test(r.path));

test('chat send: the reply, and the new session is ended after it', async () => {
  const r = await sb.run(['chat', 'send', AGENT, '--message', 'hi']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.reply, 'echo: hi');
  assert.equal(r.json.turn, 1);
  assert.equal(r.json.ended, true);
  const sent = turns()[0];
  assert.deepEqual(Object.keys(sent.body).sort(), ['agentId', 'identifier', 'input']);
  assert.match(sent.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.equal(ends().length, 1);
  assert.equal(mock.state.chats[r.json.sessionId].ended, true);
  assert.match(r.errors[0].note, /lookup_order, book_slot/);
});

test('the identifier: made from the key (not the key), the same every time, another for another key; --identifier wins', async () => {
  await sb.run(['chat', 'send', AGENT, '--message', 'a']);
  await sb.run(['chat', 'send', AGENT, '--message', 'b']);
  const [a, b] = turns().map((t) => t.body.identifier);
  assert.match(a, /^telenow-cli-[0-9a-f]{16}$/);
  assert.equal(a, b);
  assert.ok(!a.includes(GOOD_KEY.slice(-8)));
  await sb.run(['chat', 'send', AGENT, '--message', 'c'], { env: { TELENOW_API_KEY: OTHER_KEY } });
  assert.notEqual(turns()[2].body.identifier, a);
  await sb.run(['chat', 'send', AGENT, '--message', 'd', '--identifier', 'customer-42']);
  assert.equal(turns()[3].body.identifier, 'customer-42');
});

test('--keep leaves it open; --session continues (still open); --end ends it; chat end is idempotent', async () => {
  let r = await sb.run(['chat', 'send', AGENT, '--message', 'one', '--keep', '--var', 'plan=pro', '--var', 'name=Asha']);
  assert.equal(r.code, 0, r.err);
  const id = r.json.sessionId;
  assert.equal(r.json.ended, false);
  assert.equal(ends().length, 0);
  assert.deepEqual(turns()[0].body.variables, { plan: 'pro', name: 'Asha' });
  assert.match(r.errors.find((e) => e.next).next, new RegExp(`--session ${id}`));
  r = await sb.run(['chat', 'send', AGENT, '--message', 'two', '--session', id]);
  assert.equal(r.json.turn, 2);
  assert.equal(r.json.ended, false);
  assert.equal(turns()[1].body.sessionId, id);
  assert.equal(ends().length, 0);
  r = await sb.run(['chat', 'send', AGENT, '--message', 'three', '--session', id, '--end']);
  assert.equal(r.json.ended, true);
  r = await sb.run(['chat', 'end', id]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { sessionId: id, ended: true });
});

test('chat send refuses mixed-up options before sending anything', async () => {
  for (const argv of [
    ['chat', 'send', AGENT],
    ['chat', 'send', AGENT, '--message', ' '],
    ['chat', 'send', AGENT, '--message', 'x', '--session', 's1', '--var', 'a=1'],
    ['chat', 'send', AGENT, '--message', 'x', '--session', 's1', '--keep'],
    ['chat', 'send', AGENT, '--message', 'x', '--end'],
  ]) {
    const r = await sb.run(argv);
    assert.equal(r.code, 1, argv.join(' '));
  }
  assert.equal(mock.requests.length, 0);
});

test('an agent that can phone people from a chat needs a yes; other follow-up shapes do not ask', async () => {
  let r = await sb.run(['chat', 'send', DIALER, '--message', 'hi']);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'needs_yes');
  assert.match(r.errors[0].error.message, /can phone people/);
  assert.equal(turns().length, 0);
  r = await sb.run(['chat', 'send', DIALER, '--message', 'hi'], { tty: true, stdin: 'no\n' });
  assert.equal(r.code, 1);
  assert.equal(turns().length, 0);
  r = await sb.run(['chat', 'send', DIALER, '--message', 'hi'], { tty: true, stdin: 'yes\n' });
  assert.equal(r.code, 0, r.err);
  r = await sb.run(['chat', 'send', DIALER, '--message', 'hi', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.equal(turns().length, 2);
  for (const followup of [true, { enabled: true }, { enabled: false, chat: true }, { enabled: 'true', chat: true }]) {
    mock.state.agents[DIALER].session_config = { followup };
    r = await sb.run(['chat', 'send', DIALER, '--message', 'hi']);
    assert.equal(r.code, 0, `${JSON.stringify(followup)}: ${r.err}`);
  }
});

test("the server's refusals say what to do: 410 ended, 409 busy, 403 another identifier", async () => {
  const id = (await sb.run(['chat', 'send', AGENT, '--message', 'x', '--keep'])).json.sessionId;
  mock.state.chatBusy = true;
  let r = await sb.run(['chat', 'send', AGENT, '--message', 'y', '--session', id]);
  assert.equal(r.code, 4);
  assert.match(r.errors[0].error.hint, /still being written/);
  mock.state.chatBusy = false;
  r = await sb.run(['chat', 'send', AGENT, '--message', 'y', '--session', id, '--identifier', 'someone-else']);
  assert.equal(r.code, 2);
  assert.match(r.errors[0].error.hint, /same --identifier/);
  mock.state.chatExpire = true;
  r = await sb.run(['chat', 'send', AGENT, '--message', 'y', '--session', id]);
  assert.equal(r.code, 1);
  assert.equal(r.errors[0].error.code, 'SESSION_EXPIRED');
  assert.match(r.errors[0].error.hint, /without --session/);
});

test('options in a reply come through; --option answers one', async () => {
  let r = await sb.run(['chat', 'send', AGENT, '--message', 'menu', '--keep']);
  assert.equal(r.json.ui.kind, 'options');
  const id = r.json.sessionId;
  r = await sb.run(['chat', 'send', AGENT, '--session', id, '--message', 'Pro', '--option', 'plan_pro']);
  assert.equal(r.code, 0, r.err);
  assert.equal(turns()[1].body.optionId, 'plan_pro');
  assert.equal(mock.state.chats[id].lastOptionId, 'plan_pro');
});

test('the reply is kept when ending the session fails; --dry-run reads and sends nothing', async () => {
  mock.state.respond = (req) =>
    req.method === 'POST' && req.path.endsWith('/end') ? { status: 503, body: { success: false, error: 'busy' } } : undefined;
  let r = await sb.run(['chat', 'send', AGENT, '--message', 'hi']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.reply, 'echo: hi');
  assert.equal(r.json.ended, false);
  assert.match(r.errors.find((e) => e.warning).warning, /telenow chat end/);
  mock.state.respond = undefined;
  mock.requests.length = 0;
  r = await sb.run(['chat', 'send', DIALER, '--message', 'hi', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.request.path, '/api/v1/chat');
  assert.equal(mock.requests.length, 0);
});

test('chat messages as JSON and as text; chat end refuses a phone call; unknown ids exit 3', async () => {
  const id = (await sb.run(['chat', 'send', AGENT, '--message', 'menu'])).json.sessionId;
  let r = await sb.run(['chat', 'messages', id]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.map((m) => m.role), ['user', 'assistant']);
  r = await sb.run(['chat', 'messages', id, '--format', 'text']);
  assert.equal(r.out, 'user: menu\nassistant: echo: menu\n  1. Basic\n  2. Pro — everything\n');
  r = await sb.run(['chat', 'messages', 'nope']);
  assert.equal(r.code, 3);
  mock.state.voiceSessions = ['call-1'];
  r = await sb.run(['chat', 'end', 'call-1']);
  assert.equal(r.code, 3);
  r = await sb.run(['chat', 'end', 'nope', '--dry-run']);
  assert.equal(r.code, 0);
  assert.equal(r.json.request.path, '/api/v1/chat/nope/end');
});

test('chat <agent> needs a terminal', async () => {
  const r = await sb.run(['chat', AGENT], { stdin: 'hi\n' });
  assert.equal(r.code, 1);
  assert.match(r.errors[0].error.message, /chat send/);
  assert.equal(mock.requests.length, 0);
});

test('chat <agent> in a terminal: one turn per line, a number picks an option, ended on /end', async () => {
  const n = process.listenerCount('SIGINT');
  const r = await sb.run(['chat', AGENT, '--var', 'plan=pro'], { tty: true, stdin: 'hello\n\nmenu\n2\n/end\nnever sent\n' });
  assert.equal(r.code, 0, r.err);
  const id = Object.keys(mock.state.chats)[0];
  assert.equal(r.out, `Helper: echo: hello\nHelper: echo: menu\n  1. Basic\n  2. Pro — everything\nHelper: echo: Pro\nChat ended after 3 turns (session ${id}).\n`);
  const t = turns();
  assert.equal(t.length, 3);
  assert.deepEqual(t[0].body.variables, { plan: 'pro' });
  assert.equal(t[1].body.variables, undefined);
  assert.deepEqual([t[2].body.input, t[2].body.optionId], ['Pro', 'plan_pro']);
  assert.equal(ends().length, 1);
  assert.equal(process.listenerCount('SIGINT'), n);
});

test('chat <agent>: the end of input ends the session too; a session the server ended carries on in a new one', async () => {
  let r = await sb.run(['chat', AGENT], { tty: true, stdin: 'one\n' });
  assert.equal(r.code, 0, r.err);
  assert.equal(ends().length, 1);
  mock.requests.length = 0;
  let n = 0;
  mock.state.onChatTurn = () => {
    if (++n === 2) mock.state.chatExpire = true;
  };
  r = await sb.run(['chat', AGENT], { tty: true, stdin: 'one\ntwo\n' });
  assert.equal(r.code, 0, r.err);
  const t = turns();
  assert.equal(t.length, 3, 'the second line is sent again, in a new session');
  assert.equal(t[2].body.sessionId, undefined);
  assert.equal(t[2].body.input, 'two');
  assert.match(r.err, /sending this message in a new one/);
  const last = Object.keys(mock.state.chats).at(-1);
  assert.equal(mock.state.chats[last].ended, true);
});

test('chat <agent>: Ctrl-C drops the reply in flight and still ends the session', { timeout: 20_000 }, async () => {
  const n = process.listenerCount('SIGINT');
  let k = 0;
  mock.state.onChatTurn = () => {
    if (++k === 2) {
      mock.state.chatDelayMs = 2_000;
      setTimeout(() => process.emit('SIGINT'), 100);
    }
  };
  const t0 = Date.now();
  const r = await sb.run(['chat', AGENT], { tty: true, stdin: 'one\ntwo\nthree\n' });
  assert.ok(Date.now() - t0 < 1_500, 'Ctrl-C did not wait for the reply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Helper: echo: one\nChat ended after 1 turn \(session /);
  assert.equal(ends().length, 1);
  assert.equal(turns().length, 2, 'the third line is never sent');
  assert.equal(process.listenerCount('SIGINT'), n);
});

test('chat <agent> with an agent that can phone people: the yes and the first message come from one reader', async () => {
  let r = await sb.run(['chat', DIALER], { tty: true, stdin: 'yes\nhello\n/end\n' });
  assert.equal(r.code, 0, r.err);
  assert.equal(turns().length, 1);
  assert.equal(turns()[0].body.input, 'hello');
  mock.requests.length = 0;
  r = await sb.run(['chat', DIALER], { tty: true, stdin: 'no\nhello\n' });
  assert.equal(r.code, 1);
  assert.equal(r.errors.at(-1).error.code, 'cancelled');
  assert.equal(turns().length, 0);
});
