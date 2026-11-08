/**
 * completion.ts — `telenow completion <bash|zsh|fish>`: print a shell completion script.
 *
 * In here: `completionCommand`. The script is generated from the live command list each time
 * (`completion_scripts.ts`), so it always matches the installed version; regenerate it after an
 * upgrade. How to load it is in the first lines of each script. Needs no login.
 * Not in here: the scripts themselves (`completion_scripts.ts`).
 * Called by: `features/shell/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { cliVersion } from '../../core/cli_version.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { bashScript, completionTable, fishScript, zshScript } from './completion_scripts.js';

const SHELLS = { bash: bashScript, zsh: zshScript, fish: fishScript } as const;

export const completionCommand: CommandSpec = {
  path: ['completion'],
  summary: 'print a shell completion script (bash, zsh or fish)',
  args: ['shell'],
  async run(ctx) {
    const shell = ctx.args.shell as keyof typeof SHELLS;
    if (!Object.prototype.hasOwnProperty.call(SHELLS, shell)) {
      throw new CliError(`<shell> must be one of ${Object.keys(SHELLS).join(', ')} (got '${ctx.args.shell}')`, EXIT.usage);
    }
    const table = completionTable(ctx.catalog.commands, ctx.catalog.appUsage);
    return { text: SHELLS[shell](table, cliVersion()) };
  },
};
