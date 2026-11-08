/**
 * update_sub_account.ts — `telenow sub-accounts update <id> [--name] [--external-id | --clear-external-id]
 * [--monthly-limit …] [--total-limit …] [--max-concurrent …]`: rename it, or change its limits.
 *
 * In here: `updateSubAccountCommand` → `PATCH /api/v1/sub-accounts/:id` with only what was given
 * (`name`, `externalId` (`null` to clear), `limits`; in `limits`, `none` sends `null` = no limit). It answers
 * the sub-account as it is now. The server refuses an empty change (400), a closed sub-account and an
 * `externalId` already used (409).
 * `--dry-run` shows the request.
 * Not in here: suspending it (`suspend_sub_account.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { LIMIT_OPTIONS, limitsFrom, subPath } from './sub_account_paths.js';

export const updateSubAccountCommand: CommandSpec = {
  path: ['sub-accounts', 'update'],
  summary: "rename a sub-account or change its limits ('none' removes a limit)",
  args: ['id'],
  options: {
    name: { type: 'string', value: '<name>', help: 'its new name' },
    'external-id': { type: 'string', value: '<id>', help: 'your own id for it' },
    'clear-external-id': { type: 'boolean', help: 'remove your own id from it' },
    ...LIMIT_OPTIONS,
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const v = ctx.values;
    const body: Record<string, unknown> = {};
    const name = stringOption(v, 'name');
    if (name !== undefined) body.name = name;
    const ext = stringOption(v, 'external-id');
    if (ext !== undefined && boolOption(v, 'clear-external-id')) throw new CliError('give --external-id or --clear-external-id, not both', EXIT.usage);
    if (ext !== undefined) body.externalId = ext;
    if (boolOption(v, 'clear-external-id')) body.externalId = null;
    const limits = limitsFrom(ctx);
    if (limits !== undefined) body.limits = limits;
    if (Object.keys(body).length === 0) throw new CliError('nothing to change: give --name, --external-id, or a limit', EXIT.usage);
    const w = await sendWrite(ctx, { method: 'PATCH', path: subPath(ctx.args.id), body });
    if (!w.sent) return { data: w.dryRun };
    return { data: w.res.body, raw: w.res.body };
  },
};
