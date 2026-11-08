/**
 * create_sub_account.ts — `telenow sub-accounts create --name <n> (--monthly-limit … | --total-limit … |
 * --no-limit) --key-role <role> (--save-profile <name> | --key-file <path> | --show-key)`: a new
 * sub-account and its first API key.
 *
 * In here: `createSubAccountCommand` → `POST /api/v1/sub-accounts` with `{ name, externalId?, limits?,
 * keyName?, keyRole }` → 201 `{ subAccount, apiKey: { id, key, lastFour, name, role, createdAt } }`.
 * - **It spends from YOUR wallet.** Everything the sub-account is charged comes out of the parent's
 *   balance, and with no limit set there is none. So a spend limit, or `--no-limit` said out loud, is
 *   required (decision D6). `--max-concurrent` caps its calls.
 * - **`--key-role` is required** (admin, developer or viewer; the server would default to admin). The
 *   key acts as the sub-account's owner, so `admin` can do everything inside it (buy numbers, add
 *   webhooks), and it outlives whoever made it until it is rotated or the sub-account is closed.
 * - **The key's secret is shown only once** (`save_new_key.ts`, D5). It goes to a profile or a new file,
 *   chosen and checked before the request. It is printed only with `--show-key`.
 * - **No Idempotency-Key**, and `--idempotency-key` is not offered: the server would keep the answer, the
 *   secret included, for a day, and give it to a retry. To make a retry safe instead, pass
 *   `--external-id`: a second create with it is refused (409), not made twice.
 * The server refuses a name over its length, a role it does not allow, an `externalId` already used
 * (409), and a key or creator that is not owner or admin (403).
 * `--dry-run` shows the request after the checks; nothing is sent or stored.
 * Not in here: a new key later (`rotate_sub_account_key.ts`).
 * Called by: `features/sub_accounts/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { KEY_DESTINATION_OPTIONS, keyDestination, storeNewKey, withoutSecret, type NewKey } from './save_new_key.js';
import { LIMIT_OPTIONS, limitsFrom, subPath } from './sub_account_paths.js';

export const createSubAccountCommand: CommandSpec = {
  path: ['sub-accounts', 'create'],
  summary: 'make a sub-account and its first key (spends from your wallet: a limit or --no-limit is required)',
  options: {
    name: { type: 'string', value: '<name>', help: 'its name' },
    'external-id': { type: 'string', value: '<id>', help: 'your own id for it (a retried create is then refused, not doubled)' },
    ...LIMIT_OPTIONS,
    'no-limit': { type: 'boolean', help: 'let it spend from your wallet without a limit' },
    'key-role': { type: 'string', value: '<role>', help: 'admin, developer or viewer (required)' },
    'key-name': { type: 'string', value: '<name>', help: 'a name for the key' },
    ...KEY_DESTINATION_OPTIONS,
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const v = ctx.values;
    const name = stringOption(v, 'name');
    if (!name || name.trim() === '') throw new CliError('--name is required', EXIT.usage);
    const role = stringOption(v, 'key-role');
    if (!role) throw new CliError('--key-role is required: admin, developer or viewer (the key acts inside the sub-account)', EXIT.usage, { code: 'key_role_required' });
    const limits = limitsFrom(ctx);
    const hasSpendLimit = limits !== undefined && ('monthlySpendLimitUsd' in limits || 'totalSpendLimitUsd' in limits);
    const noLimit = boolOption(v, 'no-limit');
    if (!hasSpendLimit && !noLimit) {
      throw new CliError(
        "a sub-account spends from your wallet: give --monthly-limit <usd> or --total-limit <usd>, or --no-limit to allow it without one",
        EXIT.usage,
        { code: 'spend_limit_required' },
      );
    }
    if (hasSpendLimit && noLimit) throw new CliError('give a spend limit or --no-limit, not both', EXIT.usage);
    const dest = keyDestination(ctx);
    const body: Record<string, unknown> = { name, keyRole: role };
    const ext = stringOption(v, 'external-id');
    if (ext !== undefined) body.externalId = ext;
    if (limits !== undefined) body.limits = limits;
    const keyName = stringOption(v, 'key-name');
    if (keyName !== undefined) body.keyName = keyName;
    const w = await sendWrite(ctx, { method: 'POST', path: subPath(), body });
    if (!w.sent) return { data: w.dryRun };
    const answer = (w.res.body ?? {}) as { subAccount?: { id?: string; name?: string }; apiKey?: NewKey };
    const sub = answer.subAccount ?? {};
    if (!answer.apiKey?.key || typeof sub.id !== 'string') {
      throw new CliError('the answer has no key or sub-account id', EXIT.server, { details: { answer: withoutSecret(answer) } });
    }
    const savedTo = storeNewKey(ctx, dest, answer.apiKey, { id: sub.id, name: sub.name });
    const data = { ...withoutSecret(answer), savedTo, ...(dest.show ? { key: answer.apiKey.key } : {}) };
    const notes = dest.profile ? [{ next: `telenow whoami --profile ${dest.profile}` }] : [];
    return { data, raw: withoutSecret(answer), notes };
  },
};
