/**
 * call_cost.ts — `telenow calls cost <call-id>`: what one call was charged, line by line.
 *
 * In here: `callCostCommand` → `GET /api/orgs/:orgId/calls/:id/cost`. The answer is the org's
 * price (LLM, speech, telephony, platform fee, total; money as decimal strings, passed on as
 * they are), or `data: null` until the call's bill is settled, shortly after it ends. The route
 * answers `null` for an unknown call id too, so on `null` the CLI reads the call once and says
 * which it is: not found (exit 3), still going, or not settled yet. Output:
 * `{ callId, settled, cost }`.
 * Not in here: the call itself (`get_call.ts`).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { fetchCall } from './get_call.js';

export const callCostCommand: CommandSpec = {
  path: ['calls', 'cost'],
  summary: 'show what one call was charged, line by line',
  args: ['call-id'],
  async run(ctx) {
    const id = ctx.args['call-id'];
    const res = await ctx.api().get(await ctx.orgPath(`/calls/${encodeURIComponent(id)}/cost`));
    const cost = dataOf(res.body);
    if (cost !== null && cost !== undefined) return { data: { callId: id, settled: true, cost }, raw: res.body };
    // `null` is also the answer for a call that does not exist: tell them apart (404 → exit 3).
    const call = dataOf((await fetchCall(ctx, id)).body) as { status?: unknown } | null;
    const note = call?.status === 'active'
      ? 'the call is still going; its cost is worked out after it ends'
      : 'not settled yet: the cost is worked out shortly after the call ends; try again in a few minutes';
    return { data: { callId: id, settled: false, cost: null }, raw: res.body, notes: [{ note }] };
  },
};
