/**
 * get_transcript.ts — `telenow calls transcript <call-id>`: what was said, turn by turn.
 *
 * In here: `getTranscriptCommand`. `--format text` (default) prints one line per turn,
 * `<role>: <text>` with the role exactly as the server stores it (`user`, `assistant`, …) —
 * the cheapest form for an AI assistant to read. When a call was handed between agents, the
 * speaking agent's name follows the role: `assistant (Billing Bot): …`. `--format json` prints
 * the turns as the server sends them (`role`, `text`, `at`, `agent_id`).
 * Not in here: fetching the call (`get_call.ts`).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { oneOf, type CommandSpec } from '../../core/command_spec.js';
import { fetchCall } from './get_call.js';

interface Turn {
  role?: unknown;
  text?: unknown;
  agent_id?: unknown;
}

export const getTranscriptCommand: CommandSpec = {
  path: ['calls', 'transcript'],
  summary: "print a call's transcript (text, or --format json)",
  args: ['call-id'],
  options: {
    format: { type: 'string', value: '<text|json>', help: 'text (default): one line per turn; json: the turns' },
  },
  async run(ctx) {
    const format = oneOf(ctx.values, 'format', ['text', 'json'] as const) ?? 'text';
    const res = await fetchCall(ctx, ctx.args['call-id']);
    const call = dataOf(res.body) as { transcript?: unknown; participants?: unknown } | null;
    const turns: Turn[] = Array.isArray(call?.transcript) ? (call.transcript as Turn[]) : [];
    if (format === 'json') return { data: turns, raw: res.body };
    const names =
      call?.participants && typeof call.participants === 'object' ? (call.participants as Record<string, unknown>) : {};
    const handedOff = Object.keys(names).length > 1;
    const lines = turns.map((t) => {
      const role = typeof t.role === 'string' ? t.role : 'unknown';
      const who = handedOff && typeof t.agent_id === 'string' && typeof names[t.agent_id] === 'string' ? ` (${names[t.agent_id]})` : '';
      const text = typeof t.text === 'string' ? t.text.replace(/\s*\n\s*/g, ' ') : '';
      return `${role}${who}: ${text}`;
    });
    return { text: lines.join('\n') };
  },
};
