/**
 * completion.test.mjs — `telenow completion bash|zsh|fish`, through the real bin (so the app
 * commands from its usage text are included).
 *
 * Covers: the bash function completes the first word (account groups, single commands, app
 * commands), a group's subcommands, a command's own options and the global options — driven
 * exactly as bash drives it (COMP_WORDS / COMP_CWORD → COMPREPLY); every command in the catalog
 * is in every script; zsh loads the bash function through bashcompinit (if zsh is here); fish
 * parses (if fish is here); an unknown shell is exit 1.
 * Called by: `npm test` (node --test).
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMMANDS } from '../../dist/cli/main.js';

const BIN = fileURLToPath(new URL('../../bin/telenow.mjs', import.meta.url));
const script = (shell) => execFileSync(process.execPath, [BIN, 'completion', shell], { encoding: 'utf8' });
const have = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

/** What bash would offer for `telenow <words…>` with the cursor on the last word. */
function complete(words) {
  const all = ['telenow', ...words];
  const arr = all.map((w) => `'${w.replace(/'/g, "'\\''")}'`).join(' ');
  const prog = `${script('bash')}\nCOMP_WORDS=(${arr}); COMP_CWORD=${all.length - 1}; _telenow; printf '%s\\n' "\${COMPREPLY[@]}"`;
  const r = spawnSync('bash', ['-c', prog], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\n').filter(Boolean);
}

test('bash: first words — account groups, single commands, app commands', () => {
  assert.deepEqual(complete(['ag']), ['agent-instructions', 'agents']);
  assert.deepEqual(complete(['bu']), ['build']);
  assert.ok(complete(['']).includes('campaigns'));
  assert.ok(complete(['']).includes('validate'));
  assert.ok(complete(['--']).includes('--help'));
});

test("bash: a group's subcommands, and the app's `app init`", () => {
  const subs = complete(['agents', '']);
  for (const s of ['list', 'get', 'create', 'update', 'delete', 'versions', 'diff', 'restore', 'stats']) assert.ok(subs.includes(s), s);
  assert.deepEqual(complete(['campaigns', 'st']), ['start']);
  assert.deepEqual(complete(['app', '']), ['init']);
});

test("bash: a command's own options plus the global ones", () => {
  assert.deepEqual(complete(['agents', 'list', '--li']), ['--limit']);
  assert.deepEqual(complete(['call', 'place', '--y']), ['--yes']);
  assert.ok(complete(['call', 'place', '--']).includes('--idempotency-key'));
  assert.deepEqual(complete(['whoami', '--pro']), ['--profile']);
  assert.deepEqual(complete(['analytics', '--fr']), ['--from']);
  assert.ok(!complete(['agents', 'list', '--']).includes('--yes'), "list has no --yes");
});

test('every command of the catalog is in every script', () => {
  for (const shell of ['bash', 'zsh', 'fish']) {
    const s = script(shell);
    for (const c of COMMANDS) assert.ok(s.includes(c.path.join(' ')) || s.includes(c.path.at(-1)), `${shell}: ${c.path.join(' ')}`);
  }
  const bash = script('bash');
  for (const c of COMMANDS) assert.ok(bash.includes(`"${c.path.join(' ')}")`), `bash case for ${c.path.join(' ')}`);
});

test('zsh loads the bash function through bashcompinit', { skip: !have('zsh') && 'zsh is not installed' }, () => {
  const r = spawnSync('zsh', ['-c', `${script('zsh')}\nwhence -w _telenow`], { encoding: 'utf8', env: { ...process.env, ZDOTDIR: '/nonexistent' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /_telenow: function/);
});

test('fish parses its script', { skip: !have('fish') && 'fish is not installed' }, () => {
  const r = spawnSync('fish', ['-n', '-c', script('fish')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('fish: subcommands only after their group, options only after their command', () => {
  const s = script('fish');
  assert.match(s, /-n '__fish_seen_subcommand_from agents; and not __fish_seen_subcommand_from list get [^']*' -a 'list'/);
  assert.match(s, /-n '__fish_seen_subcommand_from call; and __fish_seen_subcommand_from place' -l yes -F/);
  assert.match(s, /-n '__fish_use_subcommand' -a 'build' -d 'validate, bundle \+ zip the app in this folder'/);
});

test('an unknown shell is exit 1', () => {
  const r = spawnSync(process.execPath, [BIN, 'completion', 'powershell'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be one of bash, zsh, fish/);
});
