/**
 * get_kb.ts — `telenow kb get <kb-id>`: one knowledge base with its document count.
 *
 * In here: `getKbCommand` → `GET /api/orgs/:orgId/knowledge-bases/:kbId`.
 * Not in here: its documents (`list_documents.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { kbPath, onKnowledgeOff, safeId } from './kb_paths.js';

export const getKbCommand: CommandSpec = {
  path: ['kb', 'get'],
  summary: 'show one knowledge base',
  args: ['kb-id'],
  async run(ctx) {
    const res = await onKnowledgeOff(ctx.api().get(await kbPath(ctx, `/${safeId(ctx.args['kb-id'], 'a knowledge base id')}`)));
    return { data: dataOf(res.body), raw: res.body };
  },
};
