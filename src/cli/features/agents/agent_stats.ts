/**
 * agent_stats.ts — `telenow agents stats <agent-id>`: the agent's call totals and latencies.
 *
 * In here: `agentStatsCommand` → `GET /api/agents/:id/stats` (no parameters; the agent's whole
 * history): `totalSessions`, `totalMessages`, `totalDuration`, `avgSessionDuration`,
 * `avgMessagesPerSession`, `avgServerMs`, `avgSttMs`, `avgLlmMs`, `avgTtsMs`, `avgNetRttMs`,
 * `avgFlowMs` (null when no call measured it) and `latencySamples`.
 * Not in here: org-wide numbers by day (`features/analytics/`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const agentStatsCommand: CommandSpec = {
  path: ['agents', 'stats'],
  summary: "show an agent's call totals and average latencies",
  args: ['agent-id'],
  async run(ctx) {
    const res = await ctx.api().get(`/api/agents/${encodeURIComponent(ctx.args['agent-id'])}/stats`);
    return { data: dataOf(res.body), raw: res.body };
  },
};
