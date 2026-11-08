/**
 * test_webhook.ts — `telenow webhooks test <webhook-id> --event <type>`: send one sample event
 * to your endpoint now.
 *
 * In here: `testWebhookCommand` → `POST /api/orgs/:orgId/webhooks/:id/test` (`{ eventType }`,
 * 202) → `{ delivery: { id, status, … }, deduplicated }`; follow it with
 * `telenow webhooks deliveries <webhook-id>`. The endpoint must subscribe to the event. The server
 * allows it to an owner or admin (both the key and its creator), counts it against an hourly
 * budget, and refuses with a `code` the CLI prints as it is (`webhook_event_unknown` lists the
 * real events, `webhook_event_not_subscribed`, …). Idempotency-Key; `--dry-run`.
 * Not in here: replaying a past delivery (`replay_delivery.ts`).
 * Called by: `features/webhooks/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, sendWrite } from '../../core/write_request.js';
import { webhookId } from './webhook_id.js';

export const testWebhookCommand: CommandSpec = {
  path: ['webhooks', 'test'],
  summary: 'send one sample event to your endpoint now',
  args: ['webhook-id'],
  options: {
    event: { type: 'string', value: '<type>', help: 'the event to send (one the endpoint subscribes to)' },
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const event = stringOption(ctx.values, 'event');
    if (!event) throw new CliError('--event is required', EXIT.usage);
    const id = webhookId(ctx.args['webhook-id']);
    const w = await sendWrite(ctx, { method: 'POST', path: await ctx.orgPath(`/webhooks/${id}/test`), body: { eventType: event }, creates: true });
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body, notes: [{ next: `telenow webhooks deliveries ${id}` }] };
  },
};
