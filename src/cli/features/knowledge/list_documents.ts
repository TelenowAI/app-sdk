/**
 * list_documents.ts — `telenow kb docs <kb-id>`: a knowledge base's documents and their state.
 *
 * In here: `listDocumentsCommand` → `GET /api/orgs/:orgId/knowledge-bases/:kbId/documents`
 * (`data.documents`, no document bodies). `status` moves `pending` → `embedding` → `embedded`
 * (searchable) or `failed` (see `error`); CSV / JSON / XLSX uploads are `indexed` (looked up as
 * data, not embedded).
 * Not in here: adding one (`add_document.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { kbPath, onKnowledgeOff, safeId } from './kb_paths.js';

export const listDocumentsCommand: CommandSpec = {
  path: ['kb', 'docs'],
  summary: "list a knowledge base's documents and whether each is ready",
  args: ['kb-id'],
  async run(ctx) {
    const res = await onKnowledgeOff(
      ctx.api().get(await kbPath(ctx, `/${safeId(ctx.args['kb-id'], 'a knowledge base id')}/documents`)),
    );
    const d = dataOf(res.body) as { documents?: unknown } | null;
    return {
      data: Array.isArray(d?.documents) ? d.documents : [],
      defaultFields: ['id', 'title', 'source_type', 'status', 'error', 'char_count', 'updated_at'],
      raw: res.body,
    };
  },
};
