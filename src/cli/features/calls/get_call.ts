/**
 * get_call.ts — `telenow calls get <call-id>`: one call, whole, transcript included.
 *
 * In here: `getCallCommand` → `GET /api/orgs/:orgId/calls/:id`, and `fetchCall`, which
 * `get_transcript.ts` shares. A call whose content was purged comes back without it — the
 * server decides that, not the CLI.
 * Not in here: the transcript as text (`get_transcript.ts`).
 * Called by: `features/calls/register.ts`, `get_transcript.ts`.
 */

import { dataOf, type ApiResponse } from '../../core/api_client.js';
import type { CommandContext, CommandSpec } from '../../core/command_spec.js';

export async function fetchCall(ctx: CommandContext, callId: string): Promise<ApiResponse> {
  const org = encodeURIComponent(await ctx.orgId());
  return ctx.api().get(`/api/orgs/${org}/calls/${encodeURIComponent(callId)}`);
}

export const getCallCommand: CommandSpec = {
  path: ['calls', 'get'],
  summary: 'show one call with its transcript',
  args: ['call-id'],
  async run(ctx) {
    const res = await fetchCall(ctx, ctx.args['call-id']);
    return { data: dataOf(res.body), raw: res.body };
  },
};
