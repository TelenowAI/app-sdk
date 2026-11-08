/**
 * webhook_id.ts — a webhook id that goes into a path.
 *
 * In here: `webhookId` (letters, digits, `_`, `-` only).
 * Not in here: the commands.
 * Called by: `disable_webhook.ts`, `test_webhook.ts`, `list_deliveries.ts`, `replay_delivery.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function webhookId(raw: string): string {
  if (!SAFE.test(raw)) throw new CliError(`'${raw}' is not a webhook id (see telenow webhooks list)`, EXIT.usage);
  return raw;
}
