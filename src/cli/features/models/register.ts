/**
 * register.ts — the model catalog commands.
 *
 * Files in this folder:
 *   read_catalog.ts  GET /api/catalog, its kinds, providers and models (shared with the agent check)
 *   list_models.ts   telenow models list   the providers and models an agent can use
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { listModelsCommand } from './list_models.js';

export const modelCommands: CommandSpec[] = [listModelsCommand];
