/**
 * get_analytics.ts — `telenow analytics [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--agent <id>]`:
 * the org's call numbers over a window of days (UTC).
 *
 * In here: `getAnalyticsCommand` → `GET /api/orgs/:orgId/analytics` (`from`, `to`, `agentId`;
 * default: the last 30 days; the server refuses a window over a year): `totalCalls`,
 * `completed`, `missed`, `inProgress`, `machineAnswered`, `totalSeconds`, `avgSeconds`,
 * `avgResponseMs`, `daily: [{ day, calls, completed, missed, seconds }]` and
 * `agents: [{ agentId, agentName, calls, completed, seconds }]`. The `to` it echoes back is
 * exclusive: midnight after the last day asked for.
 * Not in here: one agent's lifetime totals and latencies (`telenow agents stats`).
 * Called by: `features/analytics/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(v: string | undefined, name: string): string | undefined {
  if (v !== undefined && !DAY.test(v)) throw new CliError(`--${name} must be a day, YYYY-MM-DD (got '${v}')`, EXIT.usage);
  return v;
}

export const getAnalyticsCommand: CommandSpec = {
  path: ['analytics'],
  summary: "show the org's call numbers per day and per agent (default: last 30 days)",
  options: {
    from: { type: 'string', value: '<YYYY-MM-DD>', help: 'first day (UTC)' },
    to: { type: 'string', value: '<YYYY-MM-DD>', help: 'last day (UTC), included' },
    agent: { type: 'string', value: '<agent-id>', help: "only this agent's calls" },
  },
  async run(ctx) {
    const v = ctx.values;
    const res = await ctx.api().get(await ctx.orgPath('/analytics'), {
      query: { from: day(stringOption(v, 'from'), 'from'), to: day(stringOption(v, 'to'), 'to'), agentId: stringOption(v, 'agent') },
    });
    return { data: dataOf(res.body), raw: res.body };
  },
};
