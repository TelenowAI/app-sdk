/**
 * disable_webhook.ts — `telenow webhooks disable <webhook-id>`: stop sending events to an
 * endpoint.
 *
 * In here: `disableWebhookCommand`. It reads the list to name the URL in the question, asks (or
 * needs `--yes`), then `DELETE /api/orgs/:orgId/webhooks/:id` (the server keeps the row, disabled).
 * The server answers success even for an unknown id, so an id missing from the list is refused
 * here (exit 3). Allowed to an owner or admin. `--dry-run` shows the request.
 * Not in here: creating one (`create_webhook.ts`).
 * Called by: `features/webhooks/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { webhookId } from './webhook_id.js';

export const disableWebhookCommand: CommandSpec = {
  path: ['webhooks', 'disable'],
  summary: 'stop sending events to an endpoint (asks first, or --yes)',
  args: ['webhook-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = webhookId(ctx.args['webhook-id']);
    if (!isDryRun(ctx)) {
      const d = dataOf((await ctx.api().get(await ctx.orgPath('/webhooks'))).body) as { endpoints?: { id?: unknown; url?: unknown }[] } | null;
      const ep = (Array.isArray(d?.endpoints) ? d.endpoints : []).find((e) => e.id === id);
      if (!ep) throw new CliError(`no active webhook ${id} (see telenow webhooks list)`, EXIT.notFound);
      await confirmAction(ctx, `Stop sending events to ${String(ep.url)} (webhook ${id}).`);
    }
    const w = await sendWrite(ctx, { method: 'DELETE', path: await ctx.orgPath(`/webhooks/${id}`) });
    if (!w.sent) return { data: w.dryRun };
    return { data: { webhookId: id, disabled: true }, raw: w.res.body };
  },
};
