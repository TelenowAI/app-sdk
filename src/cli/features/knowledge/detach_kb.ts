/**
 * detach_kb.ts — `telenow kb detach <kb-id> --agent <agent-id>`: stop an agent answering from a
 * knowledge base.
 *
 * In here: `detachKbCommand` → `DELETE /api/orgs/:orgId/agents/:agentId/knowledge-bases/:kbId`.
 * The server answers success even when it was not attached. The knowledge base itself stays.
 * `--dry-run`.
 * Not in here: attaching (`attach_kb.ts`), deleting the knowledge base (`delete_kb.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { AGENT_OPTION, agentKbPath, onKnowledgeOff, requireAgent, safeId } from './kb_paths.js';

export const detachKbCommand: CommandSpec = {
  path: ['kb', 'detach'],
  summary: 'stop an agent answering from a knowledge base (the knowledge base stays)',
  args: ['kb-id'],
  options: { agent: AGENT_OPTION, 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const agent = requireAgent(stringOption(ctx.values, 'agent'));
    const path = await agentKbPath(ctx, agent, `/${safeId(ctx.args['kb-id'], 'a knowledge base id')}`);
    const w = await onKnowledgeOff(sendWrite(ctx, { method: 'DELETE', path }));
    if (!w.sent) return { data: w.dryRun };
    return { data: { kbId: ctx.args['kb-id'], agentId: agent, detached: true }, raw: w.res.body };
  },
};
