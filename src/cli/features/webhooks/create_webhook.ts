/**
 * create_webhook.ts — `telenow webhooks create --url <https://…> [--events a,b]`: send the org's
 * events to a URL.
 *
 * In here: `createWebhookCommand` → `POST /api/orgs/:orgId/webhooks` (`{ url, events?, agentId?,
 * includeRecording?, includeTranscript? }`, 201) → `{ endpoint, signing_secret }`. The signing
 * secret is shown ONCE — the note on stderr says to store it now.
 * This route stores any event name it is given, so the CLI first asks the server whether each
 * named event exists (`GET /api/v1/events/sample?type=<event>`: a sample for a real event, a 400
 * listing the real ones otherwise) — the server's own list, never one kept in the CLI. `*` (all
 * events, the default) is not looked up. Idempotency-Key; `--dry-run` (it still checks events).
 * Not in here: turning one off (`disable_webhook.ts`), sending a test (`test_webhook.ts`).
 * Called by: `features/webhooks/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, sendWrite } from '../../core/write_request.js';

export const createWebhookCommand: CommandSpec = {
  path: ['webhooks', 'create'],
  summary: "send the org's events to a URL (the signing secret is shown once)",
  options: {
    url: { type: 'string', value: '<https://…>', help: 'your endpoint (required, https)' },
    events: { type: 'string', value: '<a,b>', help: 'event names, comma-separated (default: all, *)' },
    agent: { type: 'string', value: '<agent-id>', help: "only this agent's events" },
    'include-recording': { type: 'boolean', help: 'add the recording link to call events' },
    'include-transcript': { type: 'boolean', help: 'add the transcript to call events' },
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const v = ctx.values;
    const url = stringOption(v, 'url');
    if (!url || !/^https:\/\//i.test(url)) throw new CliError('--url is required and must start with https://', EXIT.usage);
    const events = (stringOption(v, 'events') ?? '*')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    for (const e of events) {
      if (e === '*') continue;
      try {
        await ctx.api().get('/api/v1/events/sample', { query: { type: e } });
      } catch (err) {
        if (err instanceof CliError && err.status === 400) {
          throw new CliError(`'${e}' is not an event this server sends: ${err.message}`, EXIT.usage, { code: 'unknown_event' });
        }
        throw err;
      }
    }
    const body = {
      url,
      events,
      agentId: stringOption(v, 'agent'),
      includeRecording: boolOption(v, 'include-recording') || undefined,
      includeTranscript: boolOption(v, 'include-transcript') || undefined,
    };
    const w = await sendWrite(ctx, { method: 'POST', path: await ctx.orgPath('/webhooks'), body, creates: true });
    if (!w.sent) return { data: w.dryRun };
    return {
      data: dataOf(w.res.body),
      raw: w.res.body,
      notes: [{ note: 'signing_secret is shown only now: store it to verify the X-Telenow-Signature of each delivery' }],
    };
  },
};
