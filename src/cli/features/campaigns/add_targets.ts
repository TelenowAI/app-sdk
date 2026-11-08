/**
 * add_targets.ts — `telenow campaigns add-targets <campaign-id> --file people.csv|people.json`.
 *
 * In here: `addTargetsCommand`. The file is read and checked first (`target_file.ts`); then:
 * - the campaign is read: adding people to a RUNNING campaign gets them called, and adding to a
 *   COMPLETED one reopens it and calls them — both ask first (or need `--yes`); a draft or
 *   paused campaign does not; a cancelled one is refused by the server;
 * - CSV → `POST /api/orgs/:orgId/campaigns/:id/targets` (multipart, part `file`, no
 *   Idempotency-Key — `core/write_request.ts`; the server suppresses numbers already pending):
 *   `{ added, suppressed }`;
 * - JSON → `POST /api/v1/campaigns/:id/targets` (`{ source, targets }`) in batches of at most
 *   `V1_PUSH_MAX` rows, the server's per-request cap: rows with an `id` already pushed under the
 *   same `--source` are skipped as duplicates, so re-running after a failure adds nobody twice.
 *   The counters of every batch are added up: `added`, `duplicates`, `suppressed` (do-not-call, or
 *   already queued), `skipped` (blank), `withoutId`.
 * `--dry-run` reads and checks the file and shows the request(s); nothing is sent or asked.
 * Not in here: starting the campaign (`start_campaign.ts`).
 * Called by: `features/campaigns/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { campaignId, campaignPath, describe, fetchCampaign, v1CampaignPath } from './campaign_paths.js';
import { readTargetFile } from './target_file.js';

/** The most rows `POST /api/v1/campaigns/:id/targets` takes in one request (campaigns routes.rs:259). */
const V1_PUSH_MAX = 1000;
const COUNTERS = ['added', 'duplicates', 'suppressed', 'skipped', 'withoutId'] as const;

export const addTargetsCommand: CommandSpec = {
  path: ['campaigns', 'add-targets'],
  summary: 'add people to call from a .csv or .json file (asks first if they would be called now)',
  args: ['campaign-id'],
  options: {
    file: { type: 'string', value: '<path>', help: '.csv with a phone_number column, or .json [{phoneNumber, id?, variables?}]' },
    source: { type: 'string', value: '<name>', help: 'JSON only: the list name ids are deduplicated within (default cli)' },
    yes: YES_OPTION,
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const id = campaignId(ctx.args['campaign-id']);
    const f = readTargetFile(ctx.cwd, stringOption(ctx.values, 'file'));
    const count = f.kind === 'csv' ? f.rows : f.targets.length;
    if (!isDryRun(ctx)) {
      const c = await fetchCampaign(ctx, id);
      if (c.status === 'running' || c.status === 'completed') {
        await confirmAction(
          ctx,
          `Add ${count} people to ${describe(c)}. ` +
            (c.status === 'completed' ? 'This reopens the campaign and calls them.' : 'They will be called as soon as the campaign gets to them.') +
            ' Calls cost money.',
        );
      }
    }
    if (f.kind === 'csv') {
      const w = await sendWrite(ctx, {
        method: 'POST',
        path: await campaignPath(ctx, `/${id}/targets`),
        file: { field: 'file', path: f.path, type: 'text/csv' },
        creates: true,
      });
      if (!w.sent) return { data: { ...w.dryRun, rows: count } };
      return { data: dataOf(w.res.body), raw: w.res.body };
    }
    const source = stringOption(ctx.values, 'source') ?? 'cli';
    const batches: (typeof f.targets)[] = [];
    for (let i = 0; i < f.targets.length; i += V1_PUSH_MAX) batches.push(f.targets.slice(i, i + V1_PUSH_MAX));
    const totals: Record<string, number> = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
    for (const [n, targets] of batches.entries()) {
      let w;
      try {
        w = await sendWrite(ctx, { method: 'POST', path: v1CampaignPath(id, '/targets'), body: { source, targets }, creates: true });
      } catch (e) {
        if (e instanceof CliError && n > 0) {
          const withIds = f.targets.every((t) => t.id !== undefined);
          throw new CliError(
            `${e.message} — batch ${n + 1} of ${batches.length} failed; the ${n} before it were added. ` +
              (withIds ? 'Every row has an id, so re-running the same command adds nobody twice.' : 'Rows without an id would be added again on a re-run.'),
            e.exitCode,
            { status: e.status, code: e.code, details: { ...e.details, addedSoFar: totals, failedBatch: n + 1, batches: batches.length } },
          );
        }
        throw e;
      }
      if (!w.sent) return { data: { ...w.dryRun, rows: count, requests: batches.length, rowsPerRequest: V1_PUSH_MAX } };
      const d = (w.res.body ?? {}) as Record<string, unknown>;
      for (const k of COUNTERS) totals[k] += typeof d[k] === 'number' ? (d[k] as number) : 0;
      if (n === batches.length - 1) return { data: { ...totals, rows: count, requests: batches.length, source } };
    }
    return { data: { ...totals, rows: count, requests: batches.length, source } };
  },
};
