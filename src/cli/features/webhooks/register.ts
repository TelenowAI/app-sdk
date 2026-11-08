/**
 * register.ts — the webhook commands.
 *
 * Files in this folder:
 *   list_webhooks.ts    telenow webhooks list         where events are sent
 *   create_webhook.ts   telenow webhooks create       a new endpoint (events checked with the server)
 *   test_webhook.ts     telenow webhooks test         send one sample event now
 *   list_deliveries.ts  telenow webhooks deliveries   what was sent and how it went
 *   replay_delivery.ts  telenow webhooks replay       send a past event again (asks first, or --yes)
 *   disable_webhook.ts  telenow webhooks disable      stop sending (asks first, or --yes)
 *   webhook_id.ts       the id check they share
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { createWebhookCommand } from './create_webhook.js';
import { disableWebhookCommand } from './disable_webhook.js';
import { listDeliveriesCommand } from './list_deliveries.js';
import { listWebhooksCommand } from './list_webhooks.js';
import { replayDeliveryCommand } from './replay_delivery.js';
import { testWebhookCommand } from './test_webhook.js';

export const webhookCommands: CommandSpec[] = [
  listWebhooksCommand,
  createWebhookCommand,
  testWebhookCommand,
  listDeliveriesCommand,
  replayDeliveryCommand,
  disableWebhookCommand,
];
