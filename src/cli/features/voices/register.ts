/**
 * register.ts — the voice commands.
 *
 * Files in this folder:
 *   list_voices.ts  telenow voices list     a provider's voices (filtered here by language / gender)
 *   list_clones.ts  telenow voices clones   the org's cloned voices on a provider
 *   provider_arg.ts --provider, checked
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { listClonesCommand } from './list_clones.js';
import { listVoicesCommand } from './list_voices.js';

export const voiceCommands: CommandSpec[] = [listVoicesCommand, listClonesCommand];
