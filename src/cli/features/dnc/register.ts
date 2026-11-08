/**
 * register.ts — the do-not-call commands.
 *
 * Files in this folder:
 *   list_dnc.ts    telenow dnc list     the list (pages)
 *   add_dnc.ts     telenow dnc add      one number
 *   import_dnc.ts  telenow dnc import   a file of numbers
 *   remove_dnc.ts  telenow dnc remove   allow a number again (asks first, or --yes)
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { addDncCommand } from './add_dnc.js';
import { importDncCommand } from './import_dnc.js';
import { listDncCommand } from './list_dnc.js';
import { removeDncCommand } from './remove_dnc.js';

export const dncCommands: CommandSpec[] = [listDncCommand, addDncCommand, importDncCommand, removeDncCommand];
