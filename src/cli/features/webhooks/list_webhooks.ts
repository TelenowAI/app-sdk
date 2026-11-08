/**
 * list_webhooks.ts — `telenow webhooks list`: where the org's events are sent.
 *
 * In here: `listWebhooksCommand` → `GET /api/orgs/:orgId/webhooks`: `data.endpoints` (active
 * ones; `id`, `url`, `events`, `agent_id`, `include_recording`, `include_transcript`,
 * `last_ok_at`, `last_error`, …). Signing secrets are never sent back.
 * Not in here: creating (`create_webhook.ts`), deliveries (`list_deliveries.ts`).
 * Called by: `features/webhooks/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const listWebhooksCommand: CommandSpec = {
  path: ['webhooks', 'list'],
  summary: "list where the org's events are sent",
  async run(ctx) {
    const res = await ctx.api().get(await ctx.orgPath('/webhooks'));
    const d = dataOf(res.body) as { endpoints?: unknown } | null;
    return {
      data: Array.isArray(d?.endpoints) ? d.endpoints : [],
      defaultFields: ['id', 'url', 'events', 'agent_id', 'last_ok_at', 'last_error'],
      raw: res.body,
    };
  },
};
