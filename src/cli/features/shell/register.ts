/**
 * register.ts — shell integration.
 *
 * Files in this folder:
 *   completion.ts          telenow completion <bash|zsh|fish>   print a completion script
 *   completion_scripts.ts  the three scripts, generated from the live command list
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { completionCommand } from './completion.js';

export const shellCommands: CommandSpec[] = [completionCommand];
