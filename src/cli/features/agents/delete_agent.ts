/**
 * delete_agent.ts — `telenow agents delete <agent-id>`: delete an agent.
 *
 * In here: `deleteAgentCommand`. It reads the agent first, so the confirm text names it, then
 * asks (or needs `--yes`, `core/confirm_action.ts`) and sends `DELETE /api/agents/:id`.
 * `--dry-run` shows the request without asking or sending.
 * Not in here: anything about numbers or campaigns that use the agent — the server decides.
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';

export const deleteAgentCommand: CommandSpec = {
  path: ['agents', 'delete'],
  summary: 'delete an agent (asks first, or --yes)',
  args: ['agent-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = ctx.args['agent-id'];
    const path = `/api/agents/${encodeURIComponent(id)}`;
    if (!isDryRun(ctx)) {
      const agent = dataOf((await ctx.api().get(path)).body) as { name?: unknown } | null;
      await confirmAction(ctx, `Delete agent "${typeof agent?.name === 'string' ? agent.name : id}" (${id}).`);
    }
    const w = await sendWrite(ctx, { method: 'DELETE', path });
    if (!w.sent) return { data: w.dryRun };
    // The server answers `{ success, message }` with no `data` (a soft delete).
    const msg = (w.res.body as { message?: unknown } | null)?.message;
    return { data: { agentId: id, deleted: true, message: typeof msg === 'string' ? msg : null }, raw: w.res.body };
  },
};
