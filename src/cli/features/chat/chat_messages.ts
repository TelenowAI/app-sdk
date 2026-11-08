/**
 * chat_messages.ts — `telenow chat messages <session-id>`: what was said in a session.
 *
 * In here: `chatMessagesCommand` → `GET /api/v1/chat/:id/messages` → `{ sessionId, messages:
 * [{ role, content, createdAt, ui? }] }` (system lines left out by the server). It prints the
 * messages as JSON. `--format text` prints one line per message, with the options a reply offered
 * after it. Any session of the org can be read, a phone call too. The server saves each message
 * just after the turn, so the newest one may be missing for a moment.
 * Not in here: a phone call's transcript with agent names (`telenow calls transcript`).
 * Called by: `features/chat/register.ts`.
 */

import { oneOf, type CommandSpec } from '../../core/command_spec.js';
import { describeUi } from './reply_ui.js';

interface Message {
  role?: unknown;
  content?: unknown;
  ui?: unknown;
}

export const chatMessagesCommand: CommandSpec = {
  path: ['chat', 'messages'],
  summary: 'show the messages of a chat session (--format text for one line each)',
  args: ['session-id'],
  options: { format: { type: 'string', value: '<format>', help: 'json (default) or text' } },
  async run(ctx) {
    const res = await ctx.api().get(`/api/v1/chat/${encodeURIComponent(ctx.args['session-id'])}/messages`);
    const b = (res.body ?? {}) as { messages?: unknown };
    const messages = Array.isArray(b.messages) ? (b.messages as Message[]) : [];
    if (oneOf(ctx.values, 'format', ['json', 'text'] as const) !== 'text') return { data: messages, raw: res.body };
    const lines = messages.map((m) => {
      const ui = describeUi(m.ui);
      return `${String(m.role ?? '?')}: ${String(m.content ?? '')}${ui ? `\n${ui}` : ''}`;
    });
    return { text: lines.join('\n') };
  },
};
