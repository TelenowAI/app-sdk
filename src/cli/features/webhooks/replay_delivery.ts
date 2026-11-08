/**
 * replay_delivery.ts — `telenow webhooks replay <webhook-id> <delivery-id>`: send a past event to your
 * endpoint again.
 *
 * In here: `replayDeliveryCommand` → `POST /api/orgs/:orgId/webhooks/:id/deliveries/:deliveryId/replay`
 * (202 → `{ delivery: { id, endpointId, eventType, status, deliveryKind, replayOf, attempt, createdAt },
 * deduplicated }`). The worker then sends it like any event, as a new signed delivery.
 * - **It re-sends the original event's data, and your endpoint may act on it twice** (a booking or a CRM
 *   row made again). So the CLI reads the endpoint and the delivery first, by their own routes, and never
 *   prints the payload. The question names the event, when it happened, its status and the endpoint's host.
 *   It needs a typed yes, or `--yes` without a terminal.
 * - The server needs an `Idempotency-Key` on it (400 without one); the CLI always sends one. Retry with the
 *   same `--idempotency-key` and the server answers from the first send: within a day its idempotency layer
 *   gives the first answer again (a note says so: that body still reads `deduplicated: false`), later its own
 *   check answers `deduplicated: true`. One send, never two.
 * - The server refuses, with a `code` printed as it is:
 *   - an owner or admin key whose creator is an owner or admin is needed (403);
 *   - 409 `webhook_delivery_not_finished`, with `status` and `nextAttemptAt`: it is still being retried;
 *   - 400 `webhook_url_refused`;
 *   - 429: the hourly budget it shares with `webhooks test` is spent; the CLI does not wait;
 *   - 503 `webhook_manual_send_unconfigured`: this server has replays off.
 * `--dry-run` shows the request; nothing is read or sent.
 * Not in here: a sample event (`test_webhook.ts`), the list (`list_deliveries.ts`).
 * Called by: `features/webhooks/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, isDryRun, replayNotes, sendWrite } from '../../core/write_request.js';
import { webhookId } from './webhook_id.js';

interface Delivery {
  event_type?: string;
  status?: string;
  created_at?: string;
  delivery_kind?: string | null;
}

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url);
  }
}

export const replayDeliveryCommand: CommandSpec = {
  path: ['webhooks', 'replay'],
  summary: 'send a past event to your endpoint again (it may act on it twice; asks first)',
  args: ['webhook-id', 'delivery-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION, 'idempotency-key': IDEMPOTENCY_OPTION },
  async run(ctx) {
    const id = webhookId(ctx.args['webhook-id']);
    const deliveryId = webhookId(ctx.args['delivery-id']);
    const req = {
      method: 'POST' as const,
      path: await ctx.orgPath(`/webhooks/${id}/deliveries/${deliveryId}/replay`),
      creates: true,
    };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const list = dataOf((await ctx.api().get(await ctx.orgPath('/webhooks'))).body) as { endpoints?: Array<{ id?: string; url?: string }> } | null;
    const endpoint = (list?.endpoints ?? []).find((e) => e.id === id);
    if (!endpoint) throw new CliError(`no active webhook ${id} (see telenow webhooks list)`, EXIT.notFound, { status: 404 });
    const one = dataOf((await ctx.api().get(await ctx.orgPath(`/webhooks/${id}/deliveries/${deliveryId}`))).body) as {
      delivery?: Delivery;
    } | null;
    const d = one?.delivery ?? {};
    const test = d.delivery_kind === 'test' ? ' (a test event)' : '';
    await confirmAction(
      ctx,
      `Sending the ${d.event_type ?? 'event'} of ${d.created_at ?? '?'}${test} (now ${d.status ?? '?'}) to ` +
        `${hostOf(endpoint.url)} again: it carries the original data, and your endpoint may act on it twice`,
    );
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body, notes: [...replayNotes(w.res), { next: `telenow webhooks deliveries ${id}` }] };
  },
};
