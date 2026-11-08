/**
 * list_versions.ts — `telenow agents versions <agent-id>`: the agent's saved versions.
 *
 * In here: `listVersionsCommand` → `GET /api/agents/:id/versions` (newest first, the server
 * keeps the last 100): `version`, `note`, `createdAt`, `name`, `llmModel`, `ttsVoice`,
 * `savedByEmail`. The first one's `version` is what `If-Match` must name.
 * Not in here: one version's diff (`diff_version.ts`), going back to one (`restore_version.ts`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const listVersionsCommand: CommandSpec = {
  path: ['agents', 'versions'],
  summary: "list an agent's saved versions, newest first",
  args: ['agent-id'],
  async run(ctx) {
    const res = await ctx.api().get(`/api/agents/${encodeURIComponent(ctx.args['agent-id'])}/versions`);
    const d = dataOf(res.body) as { versions?: unknown } | null;
    return { data: Array.isArray(d?.versions) ? d.versions : [], raw: res.body };
  },
};
