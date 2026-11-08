/**
 * register.ts — commands about using the CLI from an AI coding assistant.
 *
 * Files in this folder:
 *   agent_instructions.ts  telenow agent-instructions   the skill text for AGENTS.md / CLAUDE.md
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { agentInstructionsCommand } from './agent_instructions.js';

export const assistantCommands: CommandSpec[] = [agentInstructionsCommand];
