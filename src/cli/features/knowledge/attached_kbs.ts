/**
 * attached_kbs.ts — `telenow kb attached --agent <agent-id>`: the knowledge bases an agent answers from.
 *
 * In here: `attachedKbsCommand` (`agent_kbs.ts`). One row per base: id, name, document count, and
 * `document_ids`. `null` there means the whole base; a list means only those documents.
 * Not in here: attaching (`attach_kb.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { readAgentKbs } from './agent_kbs.js';
import { AGENT_OPTION, requireAgent } from './kb_paths.js';

export const attachedKbsCommand: CommandSpec = {
  path: ['kb', 'attached'],
  summary: 'list the knowledge bases an agent answers from (and which documents)',
  options: { agent: AGENT_OPTION, full: { type: 'boolean', help: 'print whole rows, not the short view' } },
  async run(ctx) {
    const rows = await readAgentKbs(ctx, requireAgent(stringOption(ctx.values, 'agent')));
    return { data: rows, defaultFields: boolOption(ctx.values, 'full') ? undefined : ['id', 'name', 'document_count', 'document_ids'] };
  },
};
