/**
 * close_sub_account.ts — `telenow sub-accounts close <id>`: close a sub-account for good. IT CANNOT BE
 * UNDONE.
 *
 * In here: `closeSubAccountCommand` → `DELETE /api/v1/sub-accounts/:id` → the sub-account, now `closed`.
 * Closing revokes all its keys, ends its live calls, pauses its campaigns and removes the org. The CLI
 * reads it first, and the question names it with its live calls; it needs a typed yes or `--yes`. The
 * server refuses while it still holds phone numbers (409, release them first). Closing a closed one
 * answers it again, unchanged.
 * `--dry-run` shows the request.
 * Not in here: a pause that can be undone (`suspend_sub_account.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { readSubAccount } from './get_sub_account.js';
import { subPath } from './sub_account_paths.js';

export const closeSubAccountCommand: CommandSpec = {
  path: ['sub-accounts', 'close'],
  summary: 'close a sub-account for good — cannot be undone (asks first)',
  args: ['id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = ctx.args.id;
    const req = { method: 'DELETE' as const, path: subPath(id) };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const s = await readSubAccount(ctx, id);
    const live = typeof s.usage?.activeCalls === 'number' && s.usage.activeCalls > 0 ? `, ends its ${s.usage.activeCalls} live call(s)` : '';
    await confirmAction(
      ctx,
      `Closing ${s.name ?? id} for good: this cannot be undone; it revokes all its keys${live} and pauses its campaigns`,
    );
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    return { data: w.res.body, raw: w.res.body };
  },
};
