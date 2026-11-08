/**
 * help_text.ts — the text `telenow`, `telenow --help` and `telenow <command> --help` print.
 *
 * In here: `overallHelp` (every account command, then the app commands the package's
 * `bin/telenow.mjs` passes in, then the global options), `commandHelp` (one command's usage
 * and options) and `groupHelp` (the commands under one word, e.g. `telenow agents`).
 * Not in here: dispatch (`main.ts`).
 * Called by: `main.ts`.
 */

import type { CommandSpec, OptionSpec } from './command_spec.js';
import { GLOBAL_OPTIONS } from './global_options.js';

function usageLine(c: CommandSpec): string {
  const args = (c.args ?? []).map((a) => `<${a}>`);
  const opts = Object.keys(c.options ?? {}).length > 0 ? ['[options]'] : [];
  return ['telenow', ...c.path, ...args, ...opts].join(' ');
}

function optionLines(options: Record<string, OptionSpec>): string[] {
  const left = Object.entries(options).map(([name, o]) => {
    const short = o.short ? `-${o.short}, ` : '';
    return `  ${short}--${name}${o.value ? ' ' + o.value : ''}`;
  });
  const width = Math.max(...left.map((l) => l.length));
  return Object.values(options).map((o, i) => `${left[i].padEnd(width)}  ${o.help}`);
}

function commandLines(commands: CommandSpec[]): string[] {
  const left = commands.map((c) => `  ${usageLine(c)}`);
  const width = Math.max(...left.map((l) => l.length));
  return commands.map((c, i) => `${left[i].padEnd(width)}  ${c.summary}`);
}

export function overallHelp(commands: CommandSpec[], appUsage: string | undefined): string {
  const lines = ['Usage: telenow <command> [options]', '', 'Account commands (an org API key; see `telenow login --help`):'];
  lines.push(...commandLines(commands));
  if (appUsage && appUsage.trim().length > 0) {
    lines.push('', 'App commands (build an app for the Telenow dashboard):', appUsage.replace(/\s+$/, ''));
  }
  lines.push('', 'Global options:', ...optionLines(GLOBAL_OPTIONS));
  lines.push('', 'Run `telenow <command> --help` for a command\'s own options.');
  return lines.join('\n') + '\n';
}

export function groupHelp(word: string, commands: CommandSpec[]): string {
  return [`Commands under 'telenow ${word}':`, ...commandLines(commands), '', 'Run `telenow <command> --help` for its options.'].join('\n') + '\n';
}

export function commandHelp(c: CommandSpec): string {
  const lines = [`Usage: ${usageLine(c)}`, '', c.summary];
  if (c.options && Object.keys(c.options).length > 0) lines.push('', 'Options:', ...optionLines(c.options));
  lines.push('', 'Global options:', ...optionLines(GLOBAL_OPTIONS));
  return lines.join('\n') + '\n';
}
