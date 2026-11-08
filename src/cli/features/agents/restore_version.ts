/**
 * restore_version.ts — `telenow agents restore <agent-id> <version>`: make an old version live
 * again.
 *
 * In here: `restoreVersionCommand` → `POST /api/agents/:id/versions/:version/restore` (no body).
 * The server appends the restored state as a NEW version ("restore of vN"), so nothing is lost
 * and the restore itself can be undone the same way. The route takes no version precondition and
 * answers the agent without its new version number, so the CLI reads the version list after the
 * restore and reports the newest. `--dry-run` shows the request.
 * Not in here: the version list (`list_versions.ts`), the diff (`diff_version.ts`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { versionArg } from './diff_version.js';

export const restoreVersionCommand: CommandSpec = {
  path: ['agents', 'restore'],
  summary: 'make an old version live again (saved as a new version)',
  args: ['agent-id', 'version'],
  options: { 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = encodeURIComponent(ctx.args['agent-id']);
    const v = versionArg(ctx.args.version);
    const w = await sendWrite(ctx, { method: 'POST', path: `/api/agents/${id}/versions/${v}/restore` });
    if (!w.sent) return { data: w.dryRun };
    const versions = dataOf((await ctx.api().get(`/api/agents/${id}/versions`)).body) as { versions?: { version?: unknown }[] } | null;
    const newest = Array.isArray(versions?.versions) ? versions.versions[0]?.version : undefined;
    return {
      data: { restoredFrom: v, version: typeof newest === 'number' ? newest : null, agent: dataOf(w.res.body) },
      raw: w.res.body,
    };
  },
};
