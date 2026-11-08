/**
 * list_deliveries.ts — `telenow webhooks deliveries <webhook-id>`: what was sent to an endpoint
 * and how it went.
 *
 * In here: `listDeliveriesCommand` → `GET /api/orgs/:orgId/webhooks/:id/deliveries` (`limit`,
 * `offset`, newest first): `data.deliveries` — `id`, `event_type`, `status` (pending | delivered |
 * failed | dead), `attempt`, `response_status`, `error`, `next_attempt_at`, `delivery_kind`
 * (test | replay | null), … with the payload left out of the short view. The route's `total` is
 * the size of this page, not of the whole list, so there is no `--all`: page with `--offset`.
 * Not in here: sending a test (`test_webhook.ts`).
 * Called by: `features/webhooks/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { boolOption, intOption, type CommandSpec } from '../../core/command_spec.js';
import { webhookId } from './webhook_id.js';

export const listDeliveriesCommand: CommandSpec = {
  path: ['webhooks', 'deliveries'],
  summary: 'list what was sent to an endpoint and how it went, newest first',
  args: ['webhook-id'],
  options: {
    limit: { type: 'string', value: '<n>', help: 'rows (the server caps it)' },
    offset: { type: 'string', value: '<n>', help: 'skip this many rows first' },
    full: { type: 'boolean', help: 'include payloads and response bodies' },
  },
  async run(ctx) {
    const v = ctx.values;
    const res = await ctx.api().get(await ctx.orgPath(`/webhooks/${webhookId(ctx.args['webhook-id'])}/deliveries`), {
      query: { limit: intOption(v, 'limit', 1), offset: intOption(v, 'offset', 0) },
    });
    const d = dataOf(res.body) as { deliveries?: unknown } | null;
    return {
      data: Array.isArray(d?.deliveries) ? d.deliveries : [],
      defaultFields: boolOption(v, 'full')
        ? undefined
        : ['id', 'event_type', 'status', 'attempt', 'response_status', 'error', 'delivery_kind', 'created_at', 'next_attempt_at'],
      raw: res.body,
    };
  },
};
