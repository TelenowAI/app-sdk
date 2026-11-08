/**
 * inbound_action.ts — `telenow numbers inbound-action <number-id> --action <a> | --clear`: what a
 * number with no agent does with an incoming call.
 *
 * In here: `inboundActionCommand` → `POST /api/voice/numbers/:id/inbound-action` with `{ action }`.
 * The actions are the server's (today speak, forward, reject, no-answer); it checks the value, so
 * the CLI passes it on as given. `--clear` sends `action: null`, and the number then follows the
 * org-wide setting. Exactly one of `--action` and `--clear` is needed: an empty body would also
 * clear it, so the CLI never sends one. The server refuses a number with an agent (409: the agent
 * answers it). `--dry-run` shows the request.
 * Not in here: assigning an agent (`assign_number.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { NUMBER_VIEW, numberPath } from './number_row.js';

export const inboundActionCommand: CommandSpec = {
  path: ['numbers', 'inbound-action'],
  summary: 'set what a number with no agent does with a call (--clear: the org setting)',
  args: ['number-id'],
  options: {
    action: { type: 'string', value: '<action>', help: 'e.g. speak, forward, reject, no-answer' },
    clear: { type: 'boolean', help: "remove the number's own action; it follows the org setting" },
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const action = stringOption(ctx.values, 'action');
    const clear = boolOption(ctx.values, 'clear');
    if ((action === undefined) === !clear) throw new CliError('give exactly one of --action <action> and --clear', EXIT.usage);
    const w = await sendWrite(ctx, {
      method: 'POST',
      path: numberPath(ctx.args['number-id'], '/inbound-action'),
      body: { action: clear ? null : action },
    });
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body, defaultFields: NUMBER_VIEW };
  },
};
