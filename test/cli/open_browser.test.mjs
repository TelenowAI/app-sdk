/**
 * open_browser.test.mjs — the browser opener (`dist/cli/core/open_browser.js`), with a fake spawn:
 * no browser is ever opened.
 *
 * Covers: the program per platform (`open`, `xdg-open`, `cmd /c start "" "<url>"` with verbatim
 * arguments); the link is ONE argument, never through a shell, detached, no stdio, unref'd once
 * started; a missing program (ENOENT) and a throwing spawn are "not opened", not a crash; no
 * browser over SSH or on Linux without a display; links that are not https (file:, app paths,
 * javascript:, plain http off this computer) or that hold characters an opener would read
 * (`"`, `%`, `^`, `|`, `$`, spaces, …) are refused before any spawn.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { browserCommand, cannotOpenReason, openBrowser, unsafeLinkReason } from '../../dist/cli/core/open_browser.js';

const LINK = 'https://app.telenow.ai/cli/authorize?code=WDJB-MJHT';
const DESKTOP = { DISPLAY: ':0' };

function fakeSpawn(behaviour = 'spawn') {
  const calls = [];
  const spawn = (command, args, options) => {
    if (behaviour === 'throw') throw new Error('spawn EPERM');
    const child = new EventEmitter();
    child.unrefed = false;
    child.unref = () => {
      child.unrefed = true;
    };
    calls.push({ command, args, options, child });
    setImmediate(() => {
      if (behaviour === 'enoent') child.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' }));
      else child.emit('spawn');
    });
    return child;
  };
  return { spawn, calls };
}

test('the program per platform, with the link as one argument', () => {
  assert.deepEqual(browserCommand(LINK, 'darwin'), { command: 'open', args: [LINK], options: {} });
  assert.deepEqual(browserCommand(LINK, 'linux'), { command: 'xdg-open', args: [LINK], options: {} });
  assert.deepEqual(browserCommand(LINK, 'freebsd'), { command: 'xdg-open', args: [LINK], options: {} });
  assert.deepEqual(browserCommand(LINK, 'win32'), {
    command: 'cmd',
    args: ['/c', 'start', '""', `"${LINK}"`],
    options: { windowsVerbatimArguments: true, windowsHide: true },
  });
});

test('spawned without a shell, detached, no stdio, and let go once started', async () => {
  for (const [platform, command] of [['darwin', 'open'], ['linux', 'xdg-open'], ['win32', 'cmd']]) {
    const f = fakeSpawn();
    const r = await openBrowser(LINK, { env: DESKTOP, platform, spawn: f.spawn });
    assert.deepEqual(r, { opened: true });
    assert.equal(f.calls.length, 1);
    const [c] = f.calls;
    assert.equal(c.command, command);
    assert.ok(c.args.some((a) => a === LINK || a === `"${LINK}"`), 'the link is one whole argument');
    assert.equal(c.options.shell, false);
    assert.equal(c.options.detached, true);
    assert.equal(c.options.stdio, 'ignore');
    assert.equal(c.child.unrefed, true);
  }
});

test('a missing program or a failing spawn is "not opened", not a crash', async () => {
  let r = await openBrowser(LINK, { env: DESKTOP, platform: 'linux', spawn: fakeSpawn('enoent').spawn });
  assert.equal(r.opened, false);
  assert.match(r.reason, /xdg-open could not start: ENOENT/);
  r = await openBrowser(LINK, { env: DESKTOP, platform: 'linux', spawn: fakeSpawn('throw').spawn });
  assert.equal(r.opened, false);
  assert.match(r.reason, /EPERM/);
});

test('no browser over SSH, nor on Linux without a display', async () => {
  assert.match(cannotOpenReason({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22', DISPLAY: ':0' }, 'darwin'), /SSH/);
  assert.match(cannotOpenReason({ SSH_TTY: '/dev/pts/1' }, 'win32'), /SSH/);
  assert.match(cannotOpenReason({}, 'linux'), /no graphical display/);
  assert.equal(cannotOpenReason({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), undefined);
  assert.equal(cannotOpenReason({}, 'darwin'), undefined);
  assert.equal(cannotOpenReason({}, 'win32'), undefined);
  const f = fakeSpawn();
  const r = await openBrowser(LINK, { env: {}, platform: 'linux', spawn: f.spawn });
  assert.equal(r.opened, false);
  assert.equal(f.calls.length, 0);
});

test('only plain https links (http only on this computer) are ever handed to an opener', async () => {
  const refused = [
    'file:///etc/passwd',
    '/Applications/Calculator.app',
    '-a Calculator',
    'javascript:alert(1)',
    'http://app.telenow.ai/cli/authorize',
    'https://user:pw@app.telenow.ai/x',
    'https://app.telenow.ai/x?code="&calc"',
    'https://app.telenow.ai/%PATH%',
    'https://app.telenow.ai/x^&calc',
    'https://app.telenow.ai/x|calc',
    'https://app.telenow.ai/$(touch /tmp/x)',
    "https://app.telenow.ai/x'y",
    'https://app.telenow.ai/a b',
    'https://app.telenow.ai/!x!',
  ];
  for (const url of refused) {
    assert.ok(unsafeLinkReason(url), `accepted: ${url}`);
    for (const platform of ['darwin', 'linux', 'win32']) {
      const f = fakeSpawn();
      const r = await openBrowser(url, { env: DESKTOP, platform, spawn: f.spawn });
      assert.equal(r.opened, false, url);
      assert.equal(f.calls.length, 0, `${url} reached spawn on ${platform}`);
    }
  }
  for (const url of [LINK, 'http://localhost:5173/cli/authorize?code=AB-CD', 'http://127.0.0.1:8080/cli/authorize?code=AB-CD&x=1']) {
    assert.equal(unsafeLinkReason(url), undefined, url);
  }
});
