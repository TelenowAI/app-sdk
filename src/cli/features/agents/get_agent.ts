/**
 * get_agent.ts — `telenow agents get <agent-id>`: one agent, whole.
 *
 * In here: `getAgentCommand` → `GET /api/agents/:id`. Provider keys and tool tokens come back
 * MASKED: the CLI never asks for `?view=edit`, the one way the server hands them out in plain
 * text.
 * Not in here: the list (`list_agents.ts`), editing the prompt (`features/prompts/`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const getAgentCommand: CommandSpec = {
  path: ['agents', 'get'],
  summary: 'show one agent (secrets masked)',
  args: ['agent-id'],
  async run(ctx) {
    const res = await ctx.api().get(`/api/agents/${encodeURIComponent(ctx.args['agent-id'])}`);
    return { data: dataOf(res.body), raw: res.body };
  },
};
