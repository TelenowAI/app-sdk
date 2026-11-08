/**
 * confirm_action.ts — the rule for commands that dial, spend, start sending or delete
 * (TELENOW_CLI_PLAN.md §6.1).
 *
 * In here: `YES_OPTION` (the `--yes` flag those commands declare) and `confirmAction`. With
 * `--yes` the command goes ahead. In a terminal it prints what will happen and goes ahead only
 * on a typed `yes`. Without a terminal (a script, an AI assistant) and without `--yes` it
 * refuses — it never guesses. The text says exactly what will happen: who is called, from which
 * number, by which agent; what is deleted.
 * Not in here: `--dry-run` (`write_request.ts`), which runs before this and never asks.
 * Called by: the commands that dial, spend or delete.
 */

import { createInterface } from 'node:readline';

import { CliError, EXIT } from './cli_error.js';
import { boolOption, type CommandContext, type OptionSpec } from './command_spec.js';

export const YES_OPTION: OptionSpec = { type: 'boolean', help: 'go ahead without asking (needed when there is no terminal)' };

export async function confirmAction(ctx: CommandContext, what: string): Promise<void> {
  if (boolOption(ctx.values, 'yes')) return;
  if (!ctx.io.stdinIsTTY) {
    throw new CliError(`${what} — add --yes to go ahead (there is no terminal to ask)`, EXIT.usage, { code: 'needs_yes' });
  }
  const rl = createInterface({ input: ctx.io.stdin, terminal: false });
  // The question ends its line, so whatever follows on stderr (an error as JSON) starts a new one.
  ctx.io.stderr.write(`${what}\nType yes and press Enter to go ahead:\n`);
  const answer = await new Promise<string>((resolve) => {
    let done = false;
    rl.once('line', (line) => {
      done = true;
      resolve(line);
    });
    rl.once('close', () => {
      if (!done) resolve('');
    });
  });
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') throw new CliError('cancelled; nothing was done', EXIT.usage, { code: 'cancelled' });
}
