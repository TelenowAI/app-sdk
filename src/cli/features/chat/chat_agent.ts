/**
 * chat_agent.ts — what an agent can do for real during a text chat, read before a session starts
 * (TELENOW_CLI_PLAN.md §15.3, decision D2).
 *
 * In here: `readChatAgent` and `confirmChatRisks`.
 * - A chat runs the agent's own tools (HTTP tools, installed apps, dataset lookups) for real.
 *   The server drops only transfer, end-call and voicemail from a text turn.
 * - When the agent's follow-up calls are on for chat (`session_config.followup.enabled` AND
 *   `.chat`, both `true`, as the server reads them), it may also book a real phone call. A
 *   customer asks to be called, and the agent dials from its number, now or later. The CLI then
 *   asks first, or needs `--yes` when there is no terminal.
 * - Otherwise it only notes, on stderr, which of the agent's own tools will run.
 * Not in here: the turn itself (`chat_turn.ts`).
 * Called by: `send_chat.ts`, `chat_terminal.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandContext } from '../../core/command_spec.js';
import { confirmAction } from '../../core/confirm_action.js';

export interface ChatAgent {
  id: string;
  name: string;
  /** Follow-up calls are on for chat: a reply may book a real phone call. */
  canDial: boolean;
  /** The names of the agent's own tools (`metadata.tools`). */
  tools: string[];
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export async function readChatAgent(ctx: CommandContext, agentId: string): Promise<ChatAgent> {
  const a = dataOf((await ctx.api().get(`/api/agents/${encodeURIComponent(agentId)}`)).body);
  const agent = isObject(a) ? a : {};
  const session = isObject(agent.session_config) ? agent.session_config : {};
  const followup = session.followup;
  const canDial = isObject(followup) && followup.enabled === true && followup.chat === true;
  const meta = isObject(agent.metadata) ? agent.metadata : {};
  const tools = Array.isArray(meta.tools)
    ? meta.tools.map((t) => (isObject(t) && typeof t.name === 'string' ? t.name : null)).filter((n): n is string => n !== null)
    : [];
  return { id: agentId, name: typeof agent.name === 'string' ? agent.name : agentId, canDial, tools };
}

/** Asks before a session with an agent that can phone people; returns the notes to show either way. */
export async function confirmChatRisks(ctx: CommandContext, agent: ChatAgent): Promise<unknown[]> {
  if (agent.canDial) {
    await confirmAction(
      ctx,
      `${agent.name} can phone people from a chat: its follow-up calls are on for chat, so a reply may book a ` +
        'real call to whoever the conversation names (it rings a real phone and costs money)',
    );
  }
  if (agent.tools.length === 0) return [];
  return [{ note: `these tools of ${agent.name} run for real in a chat: ${agent.tools.join(', ')} (and any installed app's)` }];
}
