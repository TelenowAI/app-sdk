/**
 * delete_kb.ts — `telenow kb delete <kb-id>`: delete a knowledge base.
 *
 * In here: `deleteKbCommand`. Reads the knowledge base so the question names it, asks (or needs
 * `--yes`), then `DELETE /api/orgs/:orgId/knowledge-bases/:kbId`. The server soft-deletes it and
 * detaches it from every agent that used it — those agents stop answering from it at once.
 * The server allows it to an owner or admin. `--dry-run` shows the request.
 * Not in here: detaching from one agent only (`detach_kb.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { kbPath, onKnowledgeOff, safeId } from './kb_paths.js';

export const deleteKbCommand: CommandSpec = {
  path: ['kb', 'delete'],
  summary: 'delete a knowledge base; agents using it lose it (asks first, or --yes)',
  args: ['kb-id'],
  options: { yes: YES_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const path = await kbPath(ctx, `/${safeId(ctx.args['kb-id'], 'a knowledge base id')}`);
    if (!isDryRun(ctx)) {
      const kb = dataOf((await onKnowledgeOff(ctx.api().get(path))).body) as { name?: unknown; document_count?: unknown } | null;
      const name = typeof kb?.name === 'string' ? kb.name : ctx.args['kb-id'];
      const docs = typeof kb?.document_count === 'number' ? `, ${kb.document_count} documents` : '';
      await confirmAction(ctx, `Delete knowledge base "${name}"${docs}. Every agent using it stops answering from it.`);
    }
    const w = await onKnowledgeOff(sendWrite(ctx, { method: 'DELETE', path }));
    if (!w.sent) return { data: w.dryRun };
    const msg = (w.res.body as { message?: unknown } | null)?.message;
    return { data: { kbId: ctx.args['kb-id'], deleted: true, message: typeof msg === 'string' ? msg : null }, raw: w.res.body };
  },
};
