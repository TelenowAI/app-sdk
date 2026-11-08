/**
 * import_dnc.ts — `telenow dnc import --file numbers.csv`: add many do-not-call numbers at once.
 *
 * In here: `importDncCommand` → `POST /api/orgs/:orgId/dnc/import` (multipart, part `file`). The
 * server reads one number per line, or CSV with the number in column 1 and an optional reason in
 * column 2; a header line counts as one `skipped`. Answers `{ added, skipped }` (skipped:
 * unreadable, or already listed). Protective, so it does not ask. `--dry-run`. Sent without an
 * Idempotency-Key, like every upload (`core/write_request.ts`); a re-run skips numbers already listed.
 * Not in here: one number (`add_dnc.ts`).
 * Called by: `features/dnc/register.ts`.
 */

import { resolve } from 'node:path';

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';

export const importDncCommand: CommandSpec = {
  path: ['dnc', 'import'],
  summary: 'add many do-not-call numbers from a file (one per line, or CSV: number,reason)',
  options: {
    file: { type: 'string', value: '<path>', help: 'the file (required)' },
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const file = stringOption(ctx.values, 'file');
    if (!file) throw new CliError('--file is required', EXIT.usage);
    const w = await sendWrite(ctx, {
      method: 'POST',
      path: await ctx.orgPath('/dnc/import'),
      file: { field: 'file', path: resolve(ctx.cwd, file), type: 'text/csv' },
      creates: true,
    });
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body };
  },
};
