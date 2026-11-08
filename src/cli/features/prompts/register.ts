/**
 * register.ts — the prompt commands, in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   pull_prompt.ts    telenow prompts pull   live prompt (+ flow) → local files
 *   diff_prompt.ts    telenow prompts diff   local files vs the server
 *   push_prompt.ts    telenow prompts push   local files → live prompt, version-checked
 *   agent_state.ts    reading the agent: version, flow / draft rules, tool names
 *   local_changes.ts  what the local files change, and how they are compared
 *   prompt_files.ts   the .telenow folder: layout, hashes, read and write
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { diffPromptCommand } from './diff_prompt.js';
import { pullPromptCommand } from './pull_prompt.js';
import { pushPromptCommand } from './push_prompt.js';

export const promptCommands: CommandSpec[] = [pullPromptCommand, diffPromptCommand, pushPromptCommand];
