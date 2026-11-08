/**
 * list_numbers.ts — `telenow numbers list`: the org's phone numbers.
 *
 * In here: `listNumbersCommand` → `GET /api/voice/numbers` (`includeReleased`). The route is
 * not paged; it answers every number the org holds.
 * Not in here: one number (`get_number.ts`), searching, buying, releasing and assigning (the other
 * files in this folder; `register.ts` lists them).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, type CommandSpec } from '../../core/command_spec.js';

export const listNumbersCommand: CommandSpec = {
  path: ['numbers', 'list'],
  summary: "list the org's phone numbers",
  options: {
    'include-released': { type: 'boolean', help: 'also list numbers the org has released' },
  },
  async run(ctx) {
    const res = await ctx.api().get('/api/voice/numbers', {
      query: { includeReleased: boolOption(ctx.values, 'include-released') ? true : undefined },
    });
    const d = dataOf(res.body) as { numbers?: unknown } | null;
    return { data: Array.isArray(d?.numbers) ? d.numbers : [], raw: res.body };
  },
};
