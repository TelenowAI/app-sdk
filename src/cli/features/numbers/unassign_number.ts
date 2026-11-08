/**
 * unassign_number.ts — `telenow numbers unassign <number-id>`: stop an agent answering a number.
 *
 * In here: `unassignNumberCommand` → `DELETE /api/voice/numbers/:id/agent`. The server also clears
 * the default-outbound flag, and refuses a pool number (400, "unmark it first"). The CLI reads the
 * number first:
 * - no agent → nothing is sent;
 * - otherwise the question names the agent that stops answering it, and it needs a typed yes (or
 *   `--yes`), because calls to it stop reaching an agent at once.
 * `--dry-run` shows the request.
 * Not in here: assigning (`assign_number.ts`), what the number then does with a call
 * (`inbound_action.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { agentLabel, NUMBER_VIEW, numberPath, readNumber } from './number_row.js';

export const unassignNumberCommand: CommandSpec = {
  path: ['numbers', 'unassign'],
  summary: 'stop an agent answering a number (asks first)',
  args: ['number-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = ctx.args['number-id'];
    const req = { method: 'DELETE' as const, path: numberPath(id, '/agent') };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const n = await readNumber(ctx, id);
    if (!n.agent_id) {
      return { data: n, defaultFields: NUMBER_VIEW, notes: [{ note: `${n.e164} has no agent; nothing was sent` }] };
    }
    const extra = n.is_default_outbound ? '; it also stops being a default number for outbound calls' : '';
    await confirmAction(ctx, `${await agentLabel(ctx, n.agent_id)} stops answering calls to ${n.e164} now${extra}`);
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body, defaultFields: NUMBER_VIEW };
  },
};
