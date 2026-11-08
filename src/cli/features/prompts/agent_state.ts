/**
 * agent_state.ts — what the prompt commands read from an agent on the server.
 *
 * In here:
 *   fetchAgentAtVersion  the agent's current version, THEN the agent (in that order — see below)
 *   isFlowAgent          the backend's IS_FLOW_SQL / the dashboard's isFlowAgent: a LIVE
 *                        `metadata.flow` with at least one node
 *   hasDashboardDraft    the dashboard's agentEnvStatus: `!!metadata.configDraft ||
 *                        !!metadata.flowDraft` (JS truthiness, as HAS_DRAFT_SQL spells out)
 *   toolNames            `metadata.tools[].name`, for the prompt check
 *   stableJson           JSON with sorted keys, so two copies of a flow compare by content
 * Not in here: the local files (`prompt_files.ts`), the commands.
 * Called by: `pull_prompt.ts`, `diff_prompt.ts`, `push_prompt.ts`.
 *
 * What is LIVE: calls read only the top-level `system_prompt` and `metadata.flow`. The
 * dashboard's "Save draft" keeps unpublished edits in `metadata.configDraft` (single-prompt
 * agents; its `systemPrompt`) or `metadata.flowDraft` + `metadata.flowDraftGlobals` (flow
 * agents), which no call reads; "Publish" writes them to the live fields. The CLI reads and
 * writes the live fields only.
 *
 * Why version first: the version is what `prompts push` sends as `If-Match`. Read after the
 * agent, a save landing in between would pair OLD content with the NEW version, and a push
 * built on it would pass the check and overwrite that save. Read before, the same race only
 * makes the version older than the content, and the push is refused (409) — the safe side.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandContext } from '../../core/command_spec.js';

export interface AgentRow {
  id?: string;
  name?: string;
  system_prompt?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export async function fetchAgentAtVersion(ctx: CommandContext, agentId: string): Promise<{ agent: AgentRow; version: number }> {
  const id = encodeURIComponent(agentId);
  const versions = dataOf((await ctx.api().get(`/api/agents/${id}/versions`)).body) as {
    versions?: { version?: unknown }[];
  } | null;
  const newest = Array.isArray(versions?.versions) ? versions.versions[0] : undefined;
  // No history yet is version 0 — the number a precondition on a history-less agent checks.
  const version = typeof newest?.version === 'number' ? newest.version : 0;
  const agent = dataOf((await ctx.api().get(`/api/agents/${id}`)).body) as AgentRow | null;
  if (!agent || typeof agent !== 'object') {
    throw new CliError(`the server sent no agent for ${agentId}`, EXIT.server);
  }
  return { agent, version };
}

export function metadataOf(agent: AgentRow): Record<string, unknown> {
  const m = agent.metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

export function isFlowAgent(agent: AgentRow): boolean {
  const flow = metadataOf(agent).flow as { nodes?: unknown } | undefined;
  return Boolean(flow && typeof flow === 'object' && Array.isArray(flow.nodes) && flow.nodes.length > 0);
}

export function hasDashboardDraft(agent: AgentRow): boolean {
  const m = metadataOf(agent);
  return Boolean(m.configDraft) || Boolean(m.flowDraft);
}

export function toolNames(agent: AgentRow): string[] {
  const tools = metadataOf(agent).tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => (t && typeof t === 'object' ? (t as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === 'string');
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export function stableJson(v: unknown): string {
  return JSON.stringify(sortKeys(v ?? null), null, 2) + '\n';
}

export const DRAFT_NOTE =
  'this agent has unpublished changes saved in the dashboard (a draft). They are not in these files, ' +
  'and `prompts push` refuses while the draft exists: a later Publish in the dashboard would overwrite the pushed prompt.';
