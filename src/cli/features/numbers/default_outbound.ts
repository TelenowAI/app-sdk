/**
 * default_outbound.ts — `telenow numbers default-outbound <number-id> [--off]`: make a number its
 * agent's caller id for outbound calls, or stop it being one.
 *
 * In here: `defaultOutboundCommand` → `POST /api/voice/numbers/:id/default-outbound` with
 * `{ isDefault: true | false }`, ALWAYS sent explicitly: the server reads a missing field as
 * false, so an empty body would switch it off. Setting it takes the flag from the agent's previous
 * default number in the same step. The number needs an agent (400 otherwise). `--dry-run` shows the
 * request.
 * Not in here: assigning the agent (`assign_number.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { NUMBER_VIEW, numberPath } from './number_row.js';

export const defaultOutboundCommand: CommandSpec = {
  path: ['numbers', 'default-outbound'],
  summary: "make a number its agent's outbound caller id (--off to stop)",
  args: ['number-id'],
  options: {
    off: { type: 'boolean', help: 'stop it being the default' },
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const isDefault = !boolOption(ctx.values, 'off');
    const w = await sendWrite(ctx, {
      method: 'POST',
      path: numberPath(ctx.args['number-id'], '/default-outbound'),
      body: { isDefault },
    });
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body, defaultFields: NUMBER_VIEW };
  },
};
