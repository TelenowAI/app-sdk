/**
 * agent_instructions.ts — `telenow agent-instructions`: print how an AI coding assistant should
 * use this CLI, to paste into a project's AGENTS.md / CLAUDE.md (TELENOW_CLI_PLAN.md §9).
 *
 * In here: `agentInstructionsCommand`. It prints the body of the package's own
 * `skills/telenow-cli/SKILL.md` (without its frontmatter), so there is one source for both the
 * skill and the pasted block; `--path` prints where the skill file is, for tools that load
 * skills from a folder. Needs no login.
 * Not in here: the skill text itself (`skills/telenow-cli/SKILL.md`).
 * Called by: `features/assistant/register.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, type CommandSpec } from '../../core/command_spec.js';

/** dist/cli/features/assistant/ (or src/…) → the package root → skills/. */
const SKILL = new URL('../../../../skills/telenow-cli/SKILL.md', import.meta.url);

export const agentInstructionsCommand: CommandSpec = {
  path: ['agent-instructions'],
  summary: 'print how an AI coding assistant should use this CLI (for AGENTS.md / CLAUDE.md)',
  options: { path: { type: 'boolean', help: 'print the skill file location instead' } },
  async run(ctx) {
    const file = fileURLToPath(SKILL);
    if (!existsSync(file)) throw new CliError(`the skill file is missing from this install: ${file}`, EXIT.usage);
    if (boolOption(ctx.values, 'path')) return { text: file };
    const text = readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n+/, '');
    return { text };
  },
};
