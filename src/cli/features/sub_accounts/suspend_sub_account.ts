/**
 * suspend_sub_account.ts — `telenow sub-accounts suspend <id> [--reason <text>]`: stop a sub-account
 * calling or being called.
 *
 * In here: `suspendSubAccountCommand` → `POST /api/v1/sub-accounts/:id/suspend` (`{ reason }` when given).
 * **It ends the sub-account's live calls at once.** So the CLI reads it first (`get_sub_account.ts`), and
 * the question says how many calls are live now; it needs a typed yes, or `--yes`. `resume` undoes it.
 * The answer is the sub-account as it is now. A closed one is refused (409).
 * `--dry-run` shows the request.
 * Not in here: undoing it (`resume_sub_account.ts`), closing for good (`close_sub_account.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { readSubAccount } from './get_sub_account.js';
import { subPath } from './sub_account_paths.js';

export const suspendSubAccountCommand: CommandSpec = {
  path: ['sub-accounts', 'suspend'],
  summary: 'stop a sub-account calling — ends its live calls now (asks first)',
  args: ['id'],
  options: {
    reason: { type: 'string', value: '<text>', help: 'why (kept with it)' },
    yes: YES_OPTION,
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const id = ctx.args.id;
    const reason = stringOption(ctx.values, 'reason');
    const req = { method: 'POST' as const, path: subPath(id, '/suspend'), body: reason !== undefined ? { reason } : undefined };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const s = await readSubAccount(ctx, id);
    const live = typeof s.usage?.activeCalls === 'number' ? s.usage.activeCalls : null;
    const calls = live === null ? 'its live calls' : live === 1 ? 'its 1 live call' : `its ${live} live calls`;
    await confirmAction(ctx, `Suspending ${s.name ?? id}: ${calls} end now, and it cannot call or be called until you resume it`);
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    return { data: w.res.body, raw: w.res.body };
  },
};
