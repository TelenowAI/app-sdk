/**
 * run_cli.mjs — run the account commands in-process for a test, with nothing real touched.
 *
 * In here: `makeSandbox(mockUrl)` → a temp home and config file, and `run(argv, opts)` that
 * calls `main` from the BUILT dist/cli with captured stdout/stderr, a fake stdin, and a fetch
 * that refuses every address except the mock's (TELENOW_CLI_PLAN.md §8 step 1: the default
 * base URL is production, so a test that forgets to pin it must fail, not call it). Refused
 * addresses are recorded in `blocked`. The browser opener is a recorder too: links land in
 * `opened` and nothing is ever opened (`opts.openUrl` overrides it, e.g. to fail). Waits are
 * recorded in `sleeps` and return at once; `opts.onSleep(ms, n)` runs during the n-th wait (a
 * person approving in the browser while the CLI waits).
 * Not in here: the mock itself (`mock_server.mjs`).
 * Called by: the *.test.mjs files in this folder.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { main } from '../../dist/cli/main.js';

export function makeSandbox(mockUrl) {
  const home = mkdtempSync(join(tmpdir(), 'telenow-cli-test-'));
  const configFile = join(home, 'config', 'telenow.json');
  const blocked = [];
  const allowed = new URL(mockUrl).origin;
  const guardedFetch = (input, init) => {
    const origin = new URL(input).origin;
    if (origin !== allowed) {
      blocked.push(input);
      return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'BLOCKED_BY_TEST_GUARD' } }));
    }
    return fetch(input, init);
  };
  const sleeps = [];
  const opened = [];
  async function run(argv, opts = {}) {
    let out = '';
    let err = '';
    const env = {
      TELENOW_CONFIG: configFile,
      TELENOW_BASE_URL: mockUrl,
      ...(opts.env ?? {}),
    };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    const code = await main(argv, {
      env,
      cwd: opts.cwd ?? home,
      homedir: home,
      fetch: opts.fetch ?? guardedFetch,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (opts.onSleep) await opts.onSleep(ms, sleeps.length);
      },
      openUrl:
        opts.openUrl ??
        (async (url) => {
          opened.push(url);
          return { opened: true };
        }),
      io: {
        stdout: { write: (s) => (out += s) },
        stderr: { write: (s) => (err += s) },
        stdin: Readable.from(opts.stdin !== undefined ? [opts.stdin] : []),
        stdinIsTTY: opts.tty ?? false,
      },
    });
    let json;
    try {
      json = JSON.parse(out);
    } catch {
      json = undefined;
    }
    const errors = err
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return l;
        }
      });
    return { code, out, err, json, errors };
  }
  return { home, configFile, blocked, sleeps, opened, run, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
