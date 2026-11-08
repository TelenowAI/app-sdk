/**
 * reclaim_number.ts — `telenow numbers reclaim <number-id>`: buy back a number the platform released
 * (for non-payment, say) while its carrier still holds it. IT SPENDS MONEY.
 *
 * In here: `reclaimNumberCommand`.
 * - It finds the number in `numbers reclaimable` (`reclaimable_numbers.ts`). One not listed (released
 *   by the org itself, past its hold, never released) is refused before anything is sent (exit 3).
 * - The question gives the price it had, and says it is bought again at the carrier's price today.
 *   It needs a typed yes, or `--yes` without a terminal.
 * - `POST /api/voice/numbers/:id/reclaim` with an Idempotency-Key, so a retry with the same
 *   `--idempotency-key` cannot buy it twice.
 * - The answer is `{ status: "restored", number, restore: { agentRestored, … }, chargedUsd }`, or
 *   `{ status: "requested", deadline, … }` when the carrier would not hand it back automatically
 *   (an operator has been told and finishes it). Printed as it comes.
 * `--dry-run` shows the request without reading or asking.
 * Not in here: the list (`reclaimable_numbers.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, isDryRun, replayNotes, sendWrite } from '../../core/write_request.js';
import { numberPath } from './number_row.js';
import { listReclaimable } from './reclaimable_numbers.js';

export const reclaimNumberCommand: CommandSpec = {
  path: ['numbers', 'reclaim'],
  summary: 'buy back a number lost for non-payment, at today\'s price (asks first)',
  args: ['number-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION, 'idempotency-key': IDEMPOTENCY_OPTION },
  async run(ctx) {
    const id = ctx.args['number-id'];
    const req = { method: 'POST' as const, path: numberPath(id, '/reclaim'), creates: true };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const row = (await listReclaimable(ctx)).rows.find((r) => r.id === id);
    if (!row) {
      throw new CliError(
        `${id} is not a number that can be bought back now (see telenow numbers reclaimable): one you released yourself, ` +
          'one past its hold, or one never released',
        EXIT.notFound,
        { code: 'not_reclaimable' },
      );
    }
    const cur = row.priceCurrency ?? '';
    const was = row.lastMonthlyRent ? `${row.lastMonthlyRent} ${cur}`.trim() + (row.lastMonthlyRentUsd && cur !== 'USD' ? ` (about ${row.lastMonthlyRentUsd} USD)` : '') : 'not known';
    await confirmAction(
      ctx,
      `Buying ${row.e164 ?? id} back from ${row.provider ?? 'the carrier'} (hold ends ${row.reclaimDeadlineAt ?? '?'}): ` +
        `it was ${was} a month; it is bought again at the carrier's price today, charged now and monthly`,
    );
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body, notes: replayNotes(w.res) };
  },
};
