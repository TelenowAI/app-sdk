/**
 * remove_dnc.ts — `telenow dnc remove <entry-id>`: allow calls to a listed number again.
 *
 * In here: `removeDncCommand` → `DELETE /api/orgs/:orgId/dnc/:id` (the entry id from
 * `dnc list`). Removing means the number CAN BE CALLED AGAIN — and removing a caller's own
 * opt-out is recorded in the audit log — so it asks (or needs `--yes`). A repeat answers 404.
 * `--dry-run` shows the request.
 * Not in here: adding (`add_dnc.ts`).
 * Called by: `features/dnc/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const removeDncCommand: CommandSpec = {
  path: ['dnc', 'remove'],
  summary: 'allow calls to a listed number again (asks first, or --yes)',
  args: ['entry-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = ctx.args['entry-id'];
    if (!SAFE.test(id)) throw new CliError(`'${id}' is not a do-not-call entry id (see telenow dnc list)`, EXIT.usage);
    if (!isDryRun(ctx)) {
      await confirmAction(ctx, `Remove do-not-call entry ${id}: its number can be called again.`);
    }
    const w = await sendWrite(ctx, { method: 'DELETE', path: await ctx.orgPath(`/dnc/${id}`) });
    if (!w.sent) return { data: w.dryRun };
    return { data: { entryId: id, removed: true }, raw: w.res.body };
  },
};
