/**
 * list_providers.ts — `telenow numbers providers`: the carriers this org can get numbers from.
 *
 * In here: `providersCommand` → `GET /api/voice/numbers/providers` → `{ default, providers: [{ id,
 * isDefault, capabilities: { supports_compliance, supports_integration, supports_messaging } }] }`.
 * It prints the providers; the default goes to stderr as a note. The server leaves out carriers
 * that are not open to the org.
 * Not in here: searching one (`search_numbers.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const providersCommand: CommandSpec = {
  path: ['numbers', 'providers'],
  summary: 'list the carriers this org can get numbers from',
  async run(ctx) {
    const res = await ctx.api().get('/api/voice/numbers/providers');
    const d = (dataOf(res.body) ?? {}) as { default?: unknown; providers?: unknown };
    return { data: Array.isArray(d.providers) ? d.providers : [], raw: res.body, notes: [{ default: d.default ?? null }] };
  },
};
