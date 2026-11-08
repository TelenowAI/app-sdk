/**
 * release_number.ts — `telenow numbers release <number-id>`: give a number up. IT CANNOT BE UNDONE.
 *
 * In here: `releaseNumberCommand` → `DELETE /api/voice/numbers/:id` → `{ success, message }`.
 * - For a rented number, the carrier takes it back and nothing is refunded. A number the org
 *   released itself is never offered for reclaim (`numbers reclaimable`), so it can only be bought
 *   again if the carrier offers it.
 * - For a number on the org's own carrier account or trunk (`source` byoc / trunk), Telenow stops
 *   using it; it stays the org's at its carrier.
 * - Either way, its agent stops answering it, and campaigns calling from it lose their caller id.
 * The CLI reads the number first, so the question names the number, its carrier, and what it is
 * used for. It needs a typed yes, or `--yes` without a terminal. The server refuses a number a
 * team member holds for inbound calls, or one live on WhatsApp (409, with what to do first).
 * `--dry-run` shows the request.
 * Not in here: buying a lost number back (`reclaim_number.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { agentLabel, numberPath, readNumber } from './number_row.js';

export const releaseNumberCommand: CommandSpec = {
  path: ['numbers', 'release'],
  summary: 'give a number up — cannot be undone, no refund (asks first)',
  args: ['number-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = ctx.args['number-id'];
    const req = { method: 'DELETE' as const, path: numberPath(id) };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const n = await readNumber(ctx, id);
    const own = n.source === 'byoc' || n.source === 'trunk';
    const parts = [
      own
        ? `Telenow stops using ${n.e164} (it stays yours at your own carrier)`
        : `${n.e164} goes back to ${n.provider ?? 'the carrier'} for good: this cannot be undone and nothing is refunded`,
    ];
    if (n.agent_id) parts.push(`${await agentLabel(ctx, n.agent_id)} stops answering it`);
    if (n.is_default_outbound) parts.push('it stops being a default number for outbound calls');
    parts.push('campaigns calling from it lose their caller id');
    await confirmAction(ctx, `Releasing: ${parts.join('; ')}`);
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    return { data: { id, e164: n.e164, released: true }, raw: w.res.body };
  },
};
