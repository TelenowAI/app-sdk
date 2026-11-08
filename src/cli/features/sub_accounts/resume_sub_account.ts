/**
 * resume_sub_account.ts — `telenow sub-accounts resume <id>`: let a suspended sub-account call again.
 *
 * In here: `resumeSubAccountCommand` → `POST /api/v1/sub-accounts/:id/resume` → the sub-account as it is
 * now. A closed one is refused (409). `--dry-run` shows the request.
 * Not in here: suspending (`suspend_sub_account.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { subPath } from './sub_account_paths.js';

export const resumeSubAccountCommand: CommandSpec = {
  path: ['sub-accounts', 'resume'],
  summary: 'let a suspended sub-account call again',
  args: ['id'],
  options: { 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const w = await sendWrite(ctx, { method: 'POST', path: subPath(ctx.args.id, '/resume') });
    if (!w.sent) return { data: w.dryRun };
    return { data: w.res.body, raw: w.res.body };
  },
};
