/**
 * rotate_sub_account_key.ts — `telenow sub-accounts rotate-key <id> --key-role <role> (--save-profile |
 * --key-file | --show-key) [--keep-existing]`: a new API key for a sub-account.
 *
 * In here: `rotateSubAccountKeyCommand` → `POST /api/v1/sub-accounts/:id/keys` with `{ keyRole,
 * keyName?, revokeExisting }` → 201 `{ subAccountId, revokedKeys, apiKey }`.
 * - **By default every key the sub-account has stops working in the same step**, so whatever uses them
 *   (its integration, its app) stops until it gets the new one. The question says so, and it needs a typed
 *   yes or `--yes`. `--keep-existing` keeps them, so there is nothing to ask.
 * - `revokeExisting` is ALWAYS sent explicitly. The server would read a missing field as "revoke all".
 * - `--key-role` is required, as on create. The secret goes where `save_new_key.ts` puts it, checked
 *   before the request. There is no Idempotency-Key, for the same reason as on create.
 * - A closed sub-account is refused (409).
 * `--dry-run` shows the request after the checks.
 * Not in here: the first key (`create_sub_account.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { readSubAccount } from './get_sub_account.js';
import { KEY_DESTINATION_OPTIONS, keyDestination, storeNewKey, withoutSecret, type NewKey } from './save_new_key.js';
import { subPath } from './sub_account_paths.js';

export const rotateSubAccountKeyCommand: CommandSpec = {
  path: ['sub-accounts', 'rotate-key'],
  summary: "give a sub-account a new key; its current keys stop working (asks; --keep-existing keeps them)",
  args: ['id'],
  options: {
    'key-role': { type: 'string', value: '<role>', help: 'admin, developer or viewer (required)' },
    'key-name': { type: 'string', value: '<name>', help: 'a name for the key' },
    'keep-existing': { type: 'boolean', help: 'leave its current keys working' },
    ...KEY_DESTINATION_OPTIONS,
    yes: YES_OPTION,
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const id = ctx.args.id;
    const v = ctx.values;
    const role = stringOption(v, 'key-role');
    if (!role) throw new CliError('--key-role is required: admin, developer or viewer', EXIT.usage, { code: 'key_role_required' });
    const keep = boolOption(v, 'keep-existing');
    const dest = keyDestination(ctx);
    const body: Record<string, unknown> = { keyRole: role, revokeExisting: !keep };
    const keyName = stringOption(v, 'key-name');
    if (keyName !== undefined) body.keyName = keyName;
    const req = { method: 'POST' as const, path: subPath(id, '/keys'), body };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const s = await readSubAccount(ctx, id);
    if (!keep) {
      await confirmAction(
        ctx,
        `New key for ${s.name ?? id}: every key it has now stops working at once, and whatever uses them stops until it has the new one`,
      );
    }
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    const answer = (w.res.body ?? {}) as { apiKey?: NewKey };
    if (!answer.apiKey?.key) throw new CliError('the answer has no key', EXIT.server, { details: { answer: withoutSecret(answer) } });
    const savedTo = storeNewKey(ctx, dest, answer.apiKey, { id: s.id ?? id, name: s.name });
    return {
      data: { ...withoutSecret(answer), savedTo, ...(dest.show ? { key: answer.apiKey.key } : {}) },
      raw: withoutSecret(answer),
    };
  },
};
