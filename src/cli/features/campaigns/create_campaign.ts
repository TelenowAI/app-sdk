/**
 * create_campaign.ts — `telenow campaigns create`: a new campaign, as a DRAFT.
 *
 * In here: `createCampaignCommand` → `POST /api/orgs/:orgId/campaigns` (201). The org route
 * always creates a draft — nothing dials until `campaigns start` — so it does not ask first.
 * Body (camelCase): from `--file` if given, then the flags on top: `name`, `agentId`,
 * `concurrency`, `startTimeLocal` + `endTimeLocal` (`--window 09:00-18:00`), `timezone` (IANA),
 * `machineDetection`, `maxAttempts`, `retryBackoffSecs`, `retryOnNoAnswer`, `fromNumber` or
 * `fromNumberId`. The server clamps and checks them. A file holding `start`, `targets` or
 * `source` (the v1 create's extras) is warned about: this route ignores them — add people with
 * `campaigns add-targets`. Idempotency-Key; `--dry-run`.
 * Not in here: adding people (`add_targets.ts`), starting (`start_campaign.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { intOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { e164 } from '../../core/phone_number.js';
import { readJsonObject } from '../../core/read_json_file.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, sendWrite } from '../../core/write_request.js';
import { campaignPath } from './campaign_paths.js';

const WINDOW = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/;

export const createCampaignCommand: CommandSpec = {
  path: ['campaigns', 'create'],
  summary: 'create a campaign as a draft (nothing dials until start)',
  options: {
    file: { type: 'string', value: '<path|->', help: 'JSON with the campaign fields (camelCase); flags override it' },
    name: { type: 'string', value: '<name>', help: 'campaign name' },
    agent: { type: 'string', value: '<agent-id>', help: 'the agent that calls' },
    concurrency: { type: 'string', value: '<n>', help: 'calls at once (the server clamps it)' },
    window: { type: 'string', value: '<HH:MM-HH:MM>', help: 'daily calling window, in --timezone' },
    timezone: { type: 'string', value: '<IANA>', help: 'e.g. Asia/Kolkata (default UTC)' },
    from: { type: 'string', value: '<+number>', help: "caller id: one of the org's numbers" },
    'from-number-id': { type: 'string', value: '<id>', help: 'caller id by number id' },
    'max-attempts': { type: 'string', value: '<n>', help: 'attempts per person' },
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const v = ctx.values;
    const file = stringOption(v, 'file');
    const body: Record<string, unknown> = file !== undefined ? await readJsonObject(ctx, file, 'the campaign') : {};
    const notes: unknown[] = [];
    const ignored = ['start', 'targets', 'source', 'sourceName'].filter((k) => k in body);
    if (ignored.length > 0) {
      notes.push({ warning: `ignored by this route: ${ignored.join(', ')} — the campaign is created as a draft; add people with campaigns add-targets` });
      for (const k of ignored) delete body[k];
    }
    const set = (k: string, val: unknown) => {
      if (val !== undefined) body[k] = val;
    };
    set('name', stringOption(v, 'name'));
    set('agentId', stringOption(v, 'agent'));
    set('concurrency', intOption(v, 'concurrency', 1));
    set('timezone', stringOption(v, 'timezone'));
    set('maxAttempts', intOption(v, 'max-attempts', 1));
    const win = stringOption(v, 'window');
    if (win !== undefined) {
      const m = WINDOW.exec(win);
      if (!m) throw new CliError(`--window must look like 09:00-18:00 (got '${win}')`, EXIT.usage);
      body.startTimeLocal = m[1];
      body.endTimeLocal = m[2];
    }
    const from = stringOption(v, 'from');
    if (from !== undefined) body.fromNumber = e164(from, '--from');
    set('fromNumberId', stringOption(v, 'from-number-id'));
    if (body.fromNumber && body.fromNumberId) throw new CliError('give --from or --from-number-id, not both', EXIT.usage);
    if (typeof body.name !== 'string' || !body.name.trim()) throw new CliError('a name is required (--name or "name" in --file)', EXIT.usage);
    if (typeof body.agentId !== 'string') throw new CliError('an agent is required (--agent or "agentId" in --file)', EXIT.usage);
    const w = await sendWrite(ctx, { method: 'POST', path: await campaignPath(ctx, ''), body, creates: true });
    if (!w.sent) return { data: w.dryRun, notes };
    return { data: dataOf(w.res.body), raw: w.res.body, notes };
  },
};
