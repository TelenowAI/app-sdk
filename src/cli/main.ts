/**
 * main.ts — entry point of the `telenow` ACCOUNT commands (login, agents, calls, prompts, …).
 *
 * In here: `COMMANDS` (every account command, from each feature's register file) and `main`
 * (find the command, parse its options, run it, print the result or the error, return the exit
 * code). Process state (env, stdio, fetch, sleep, home folder, the browser opener) comes in
 * through `MainOptions`, so tests can run the whole CLI in-process.
 * Not in here: the app commands (`build`, `dev`, `validate`, `init`, `app init`) — those stay in
 * the package's `bin/telenow.mjs`, which calls `main` for every other command and passes its
 * app usage lines in for the help text.
 * Called by: `bin/telenow.mjs`; tests.
 */

import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import type { FetchLike } from './core/api_client.js';
import { CliError, EXIT, errorJson } from './core/cli_error.js';
import { cliVersion } from './core/cli_version.js';
import { makeContext } from './core/command_context.js';
import { stringOption, type CliIo, type CommandSpec, type OptionSpec, type OptionValues } from './core/command_spec.js';
import { GLOBAL_OPTIONS } from './core/global_options.js';
import { commandHelp, groupHelp, overallHelp } from './core/help_text.js';
import { openBrowser, type OpenUrl } from './core/open_browser.js';
import { parseFields } from './core/pick_fields.js';
import { checkOutputMode, renderOutput } from './core/print_output.js';
import { agentCommands } from './features/agents/register.js';
import { analyticsCommands } from './features/analytics/register.js';
import { assistantCommands } from './features/assistant/register.js';
import { authCommands } from './features/auth/register.js';
import { callCommands } from './features/calls/register.js';
import { campaignCommands } from './features/campaigns/register.js';
import { chatCommands } from './features/chat/register.js';
import { dncCommands } from './features/dnc/register.js';
import { flowCommands } from './features/flows/register.js';
import { knowledgeCommands } from './features/knowledge/register.js';
import { modelCommands } from './features/models/register.js';
import { numberCommands } from './features/numbers/register.js';
import { promptCommands } from './features/prompts/register.js';
import { shellCommands } from './features/shell/register.js';
import { subAccountCommands } from './features/sub_accounts/register.js';
import { voiceCommands } from './features/voices/register.js';
import { webhookCommands } from './features/webhooks/register.js';

export const COMMANDS: CommandSpec[] = [
  ...authCommands,
  ...agentCommands,
  ...promptCommands,
  ...flowCommands,
  ...callCommands,
  ...chatCommands,
  ...campaignCommands,
  ...knowledgeCommands,
  ...voiceCommands,
  ...modelCommands,
  ...numberCommands,
  ...dncCommands,
  ...webhookCommands,
  ...subAccountCommands,
  ...analyticsCommands,
  ...assistantCommands,
  ...shellCommands,
];

export interface MainOptions {
  /** The app-command lines of the package's own usage text, shown in `telenow --help`. */
  appUsage?: string;
  env?: Record<string, string | undefined>;
  io?: Partial<CliIo>;
  cwd?: string;
  homedir?: string;
  fetch?: FetchLike;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Opens a link in a browser (`telenow login`); tests pass one that only records. */
  openUrl?: OpenUrl;
}

/** A wait that ends early, and quietly, when `signal` fires: its timer is cleared, so it never holds the process open. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal }).catch(() => undefined);
}

function toParseArgsOptions(options: Record<string, OptionSpec>) {
  const out: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {};
  for (const [name, o] of Object.entries(options)) {
    out[name] = { type: o.type, ...(o.short ? { short: o.short } : {}), ...(o.multiple ? { multiple: true } : {}) };
  }
  return out;
}

/** The leading words of argv, up to the first option. */
function leadingWords(argv: string[]): string[] {
  const words: string[] = [];
  for (const a of argv) {
    if (a.startsWith('-')) break;
    words.push(a);
  }
  return words;
}

function findCommand(words: string[]): CommandSpec | undefined {
  let best: CommandSpec | undefined;
  for (const c of COMMANDS) {
    if (c.path.length <= words.length && c.path.every((w, i) => words[i] === w)) {
      if (!best || c.path.length > best.path.length) best = c;
    }
  }
  return best;
}

export async function main(argv: string[], opts: MainOptions = {}): Promise<number> {
  const io: CliIo = {
    stdout: opts.io?.stdout ?? process.stdout,
    stderr: opts.io?.stderr ?? process.stderr,
    stdin: opts.io?.stdin ?? process.stdin,
    stdinIsTTY: opts.io?.stdinIsTTY ?? Boolean(process.stdin.isTTY),
  };
  try {
    return await dispatch(argv, opts, io);
  } catch (e) {
    if (e instanceof CliError) {
      io.stderr.write(JSON.stringify(errorJson(e)) + '\n');
      return e.exitCode;
    }
    const message = e instanceof Error ? e.message : String(e);
    io.stderr.write(JSON.stringify({ error: { message: `internal error: ${message}` } }) + '\n');
    return EXIT.usage;
  }
}

async function dispatch(argv: string[], opts: MainOptions, io: CliIo): Promise<number> {
  const first = argv[0];
  if (first === undefined || first === '--help' || first === '-h') {
    io.stdout.write(overallHelp(COMMANDS, opts.appUsage));
    return EXIT.ok;
  }
  if (first === '--version' || first === 'version') {
    io.stdout.write(cliVersion() + '\n');
    return EXIT.ok;
  }
  if (first === 'help') {
    const rest = leadingWords(argv.slice(1));
    const c = rest.length > 0 ? findCommand(rest) : undefined;
    const group = COMMANDS.filter((x) => x.path[0] === rest[0]);
    if (c) io.stdout.write(commandHelp(c));
    else if (rest.length > 0 && group.length > 0) io.stdout.write(groupHelp(rest[0], group));
    else io.stdout.write(overallHelp(COMMANDS, opts.appUsage));
    return EXIT.ok;
  }

  const words = leadingWords(argv);
  const cmd = findCommand(words);
  if (!cmd) {
    const group = COMMANDS.filter((x) => x.path[0] === words[0]);
    const asked = argv.includes('--help') || argv.includes('-h');
    if (group.length > 0 && (words.length === 1 || asked)) {
      (asked ? io.stdout : io.stderr).write(groupHelp(words[0], group));
      return asked ? EXIT.ok : EXIT.usage;
    }
    throw new CliError(`unknown command '${words.join(' ') || first}'. Run \`telenow --help\` for the list.`, EXIT.usage);
  }

  const spec = { ...GLOBAL_OPTIONS, ...(cmd.options ?? {}) };
  let parsed: { values: OptionValues; positionals: string[] };
  try {
    parsed = parseArgs({
      args: argv.slice(cmd.path.length),
      options: toParseArgsOptions(spec),
      allowPositionals: true,
      strict: true,
    }) as { values: OptionValues; positionals: string[] };
  } catch (e) {
    throw new CliError(`${(e as Error).message}. Run \`telenow ${cmd.path.join(' ')} --help\`.`, EXIT.usage);
  }
  if (parsed.values.help === true) {
    io.stdout.write(commandHelp(cmd));
    return EXIT.ok;
  }
  const names = cmd.args ?? [];
  if (parsed.positionals.length < names.length) {
    throw new CliError(`missing <${names[parsed.positionals.length]}>. Usage: telenow ${cmd.path.join(' ')} ${names.map((n) => `<${n}>`).join(' ')}`, EXIT.usage);
  }
  if (parsed.positionals.length > names.length) {
    throw new CliError(`unexpected argument '${parsed.positionals[names.length]}'`, EXIT.usage);
  }
  const args: Record<string, string> = {};
  names.forEach((n, i) => (args[n] = parsed.positionals[i]));

  const mode = checkOutputMode(stringOption(parsed.values, 'output'));
  const fields = parseFields(stringOption(parsed.values, 'fields'));
  const quiet = parsed.values.quiet === true;
  const env = opts.env ?? process.env;
  const ctx = makeContext(
    {
      args,
      values: parsed.values,
      global: { profile: stringOption(parsed.values, 'profile'), baseUrl: stringOption(parsed.values, 'base-url'), quiet },
    },
    {
      env,
      io,
      cwd: opts.cwd ?? process.cwd(),
      homedir: opts.homedir ?? homedir(),
      fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
      sleep: opts.sleep ?? abortableSleep,
      openUrl: opts.openUrl ?? ((url) => openBrowser(url, { env, platform: process.platform })),
    },
    { commands: COMMANDS, appUsage: opts.appUsage },
  );
  const out = await cmd.run(ctx);
  io.stdout.write(renderOutput(out, mode, fields));
  if (!quiet) for (const n of out.notes ?? []) io.stderr.write(JSON.stringify(n) + '\n');
  return EXIT.ok;
}
