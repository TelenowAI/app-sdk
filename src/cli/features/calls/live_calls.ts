/**
 * live_calls.ts — `telenow calls live [--agent <id>]`: how many calls are going on right now.
 *
 * In here: `liveCallsCommand` → `GET /api/agents/live-calls` → `{ counts: { agentId: n }, total }`.
 * An agent with no live call is not in `counts`, so it reads as 0. Output: `{ total, agents:
 * [{ agentId, live }] }`, busiest first; with `--agent`, `{ agentId, live }`. The server counts a
 * call live while it has sent a heartbeat in the last minute; test calls and text chats are not
 * counted.
 * Not in here: listening in or ending a call (not offered).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';

export const liveCallsCommand: CommandSpec = {
  path: ['calls', 'live'],
  summary: 'show how many calls are going on right now, per agent',
  options: { agent: { type: 'string', value: '<agent-id>', help: 'only this agent' } },
  async run(ctx) {
    const res = await ctx.api().get('/api/agents/live-calls');
    const d = (dataOf(res.body) ?? {}) as { counts?: Record<string, unknown>; total?: unknown };
    const counts = d.counts && typeof d.counts === 'object' ? d.counts : {};
    const agent = stringOption(ctx.values, 'agent');
    if (agent !== undefined) {
      const n = counts[agent];
      return { data: { agentId: agent, live: typeof n === 'number' ? n : 0 }, raw: res.body };
    }
    const agents = Object.entries(counts)
      .map(([agentId, n]) => ({ agentId, live: typeof n === 'number' ? n : 0 }))
      .sort((a, b) => b.live - a.live);
    return { data: { total: typeof d.total === 'number' ? d.total : 0, agents }, raw: res.body };
  },
};
