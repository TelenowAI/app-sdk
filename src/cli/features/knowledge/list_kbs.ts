/**
 * list_kbs.ts — `telenow kb list`: the org's knowledge bases.
 *
 * In here: `listKbsCommand` → `GET /api/orgs/:orgId/knowledge-bases` (`data.knowledgeBases`,
 * snake_case rows with `document_count`). The whole route is a 404 on a server whose Knowledge
 * module is off (no embeddings) — the CLI says so instead of "not found".
 * Not in here: documents (`list_documents.ts`), attaching to an agent (`attach_kb.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { kbPath, onKnowledgeOff } from './kb_paths.js';

export const listKbsCommand: CommandSpec = {
  path: ['kb', 'list'],
  summary: "list the org's knowledge bases",
  async run(ctx) {
    const res = await onKnowledgeOff(ctx.api().get(await kbPath(ctx, '')));
    const d = dataOf(res.body) as { knowledgeBases?: unknown } | null;
    return {
      data: Array.isArray(d?.knowledgeBases) ? d.knowledgeBases : [],
      defaultFields: ['id', 'name', 'description', 'document_count', 'updated_at'],
      raw: res.body,
    };
  },
};
