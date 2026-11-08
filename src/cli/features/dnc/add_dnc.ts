/**
 * add_dnc.ts — `telenow dnc add <+number> [--reason <text>]`: never call this number.
 *
 * In here: `addDncCommand` → `POST /api/orgs/:orgId/dnc` (`{ phoneNumber, reason? }`, 201).
 * Adding protects — calls already queued to the number are dropped — so it does not ask. Adding
 * a number that is already listed refreshes its reason. Idempotency-Key; `--dry-run`.
 * Not in here: removing (`remove_dnc.ts`), a whole file (`import_dnc.ts`).
 * Called by: `features/dnc/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { e164 } from '../../core/phone_number.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, sendWrite } from '../../core/write_request.js';

export const addDncCommand: CommandSpec = {
  path: ['dnc', 'add'],
  summary: 'never call this number; queued calls to it are dropped',
  args: ['number'],
  options: {
    reason: { type: 'string', value: '<text>', help: 'why (shown in the list)' },
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const body = { phoneNumber: e164(ctx.args.number, 'the number'), reason: stringOption(ctx.values, 'reason') };
    const w = await sendWrite(ctx, { method: 'POST', path: await ctx.orgPath('/dnc'), body, creates: true });
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body };
  },
};
