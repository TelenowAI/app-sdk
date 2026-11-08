/**
 * register.ts — the flow commands.
 *
 * Files in this folder:
 *   validate_flow.ts  telenow flows validate   check a graph with the server, save nothing
 * Pulling, editing and pushing a flow agent's graph is `telenow prompts pull | diff | push`.
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { validateFlowCommand } from './validate_flow.js';

export const flowCommands: CommandSpec[] = [validateFlowCommand];
