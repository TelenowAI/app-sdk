/**
 * agent_kbs.ts — the knowledge bases an agent answers from, and which documents of each.
 *
 * In here:
 * - `readAgentKbs`: `GET /api/orgs/:org/agents/:agent/knowledge-bases` → `{ knowledgeBases: [{ id, name,
 *   document_count, …, document_ids }] }`. `document_ids: null` is the whole base; a list is exactly those
 *   documents; `[]` is none (left when every pinned document was deleted).
 * - `scopeOf`: a row's scope in words for output: `{ whole: true }` or `{ documents: n, documentIds }`.
 * Not in here: changing it (`attach_kb.ts`, `detach_kb.ts`).
 * Called by: `attach_kb.ts`, `attached_kbs.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandContext } from '../../core/command_spec.js';
import { agentKbPath, onKnowledgeOff } from './kb_paths.js';

export interface AgentKb {
  id: string;
  name?: string;
  document_ids?: string[] | null;
  [k: string]: unknown;
}

export async function readAgentKbs(ctx: CommandContext, agentId: string): Promise<AgentKb[]> {
  const res = await onKnowledgeOff(ctx.api().get(await agentKbPath(ctx, agentId, '')));
  const d = dataOf(res.body) as { knowledgeBases?: unknown } | null;
  return Array.isArray(d?.knowledgeBases) ? (d.knowledgeBases as AgentKb[]).filter((k) => typeof k?.id === 'string') : [];
}

export function scopeOf(row: AgentKb | undefined): Record<string, unknown> | null {
  if (!row) return null;
  if (!Array.isArray(row.document_ids)) return { whole: true };
  return { documents: row.document_ids.length, documentIds: row.document_ids };
}
