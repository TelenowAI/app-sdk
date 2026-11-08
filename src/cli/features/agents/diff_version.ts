/**
 * diff_version.ts — `telenow agents diff <agent-id> <version>`: what one saved version changed.
 *
 * In here: `diffVersionCommand` → `GET /api/agents/:id/versions/:version/diff`, which compares
 * that version with the one before it (version 1 with an empty agent) and answers
 * `changes: [{ path, from, to }]`. `path` is a human label ("LLM model", "Greeting (inbound)"),
 * `from`/`to` are display strings — secrets shown as "•••", long text cut, and a change hidden
 * by the cut shown as "(edited)". For the full prompt text, use `prompts pull`.
 * Not in here: the version list (`list_versions.ts`), going back (`restore_version.ts`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandSpec } from '../../core/command_spec.js';

export function versionArg(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new CliError(`<version> must be a whole number of at least 1 (got '${raw}')`, EXIT.usage);
  return n;
}

export const diffVersionCommand: CommandSpec = {
  path: ['agents', 'diff'],
  summary: 'show what one saved version changed, against the version before it',
  args: ['agent-id', 'version'],
  async run(ctx) {
    const v = versionArg(ctx.args.version);
    const res = await ctx.api().get(`/api/agents/${encodeURIComponent(ctx.args['agent-id'])}/versions/${v}/diff`);
    const d = dataOf(res.body) as { changes?: unknown } | null;
    return { data: Array.isArray(d?.changes) ? d.changes : [], raw: res.body };
  },
};
