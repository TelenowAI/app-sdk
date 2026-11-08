/**
 * get_number.ts — `telenow numbers get <number-id>`: one of the org's numbers, with its price.
 *
 * In here: `getNumberCommand` → `GET /api/voice/numbers/:id` → the number with `price_currency`,
 * `monthly_rent_usd` and `setup_price_usd` beside its own carrier-currency prices. Short view by
 * default, `--full` for the whole row. A released number is 404 (exit 3).
 * Not in here: the list (`list_numbers.ts`), changes (the other files here).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, type CommandSpec } from '../../core/command_spec.js';
import { NUMBER_VIEW, numberPath } from './number_row.js';

export const getNumberCommand: CommandSpec = {
  path: ['numbers', 'get'],
  summary: "show one of the org's numbers, with its price",
  args: ['number-id'],
  options: { full: { type: 'boolean', help: 'print the whole row, not the short view' } },
  async run(ctx) {
    const res = await ctx.api().get(numberPath(ctx.args['number-id']));
    return { data: dataOf(res.body), raw: res.body, defaultFields: boolOption(ctx.values, 'full') ? undefined : NUMBER_VIEW };
  },
};
