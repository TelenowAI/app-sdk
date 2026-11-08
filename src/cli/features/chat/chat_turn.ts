/**
 * chat_turn.ts — one turn of a text chat with an agent, and ending the session.
 *
 * In here: `sendTurn` and `endChat`. Both go to the Chat API, which takes the org API key only
 * and answers flat JSON.
 *
 * `sendTurn` → `POST /api/v1/chat` with `{ agentId, identifier, input, sessionId?, variables?,
 * optionId? }`, sent once with an `Idempotency-Key`. The answer is `{ sessionId, reply, turn,
 * identifier, ui? }`. It waits for the whole reply (no streaming), tools included.
 * - No `sessionId` starts a session. The server checks credits and limits then, and runs the
 *   agent's pre-chat lookups. `variables` count on that first turn only.
 * - `optionId`: the person picked one of the options the last reply's `ui` offered. Its title
 *   goes as `input`.
 * - The server's refusals get a line saying what to do:
 *   - 410 `SESSION_EXPIRED`: the session ended (ended, idle, a restart, or another server). Send
 *     again without `--session`; the old conversation is not carried over.
 *   - 409 `turn in progress`: a reply is still being written for this session.
 *   - 403 `identifier does not match`: a session belongs to the identifier that started it.
 * - When no answer comes in time on a FIRST turn, the session id was never seen. The error says
 *   that a session may be open, and that it ends itself when idle.
 *
 * `endChat` → `POST /api/v1/chat/:id/end`. It settles the session's bill and runs its after-call
 * analysis, and answers 200 even when the session is already gone. The server refuses (404)
 * anything that is not a Chat API session, so it can never hang up a phone call.
 * Not in here: who the agent talks to (`chat_identity.ts`), the commands.
 * Called by: `send_chat.ts`, `chat_terminal.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandContext } from '../../core/command_spec.js';
import { sendWrite } from '../../core/write_request.js';

export interface TurnRequest {
  agentId: string;
  identifier: string;
  input: string;
  sessionId?: string;
  variables?: Record<string, string>;
  optionId?: string;
  signal?: AbortSignal;
}

export interface ChatReply {
  sessionId: string;
  reply: string;
  turn: number | null;
  identifier: string;
  ui?: unknown;
}

export type TurnResult = { sent: true; reply: ChatReply; raw: unknown } | { sent: false; dryRun: Record<string, unknown> };

export async function sendTurn(ctx: CommandContext, t: TurnRequest): Promise<TurnResult> {
  const body: Record<string, unknown> = { agentId: t.agentId, identifier: t.identifier, input: t.input };
  if (t.sessionId !== undefined) body.sessionId = t.sessionId;
  if (t.variables !== undefined) body.variables = t.variables;
  if (t.optionId !== undefined) body.optionId = t.optionId;
  let w;
  try {
    w = await sendWrite(ctx, { method: 'POST', path: '/api/v1/chat', body, creates: true, signal: t.signal });
  } catch (e) {
    throw explain(e, t);
  }
  if (!w.sent) return { sent: false, dryRun: w.dryRun };
  const b = (w.res.body ?? {}) as Record<string, unknown>;
  if (typeof b.sessionId !== 'string') {
    throw new CliError('the chat answer has no sessionId', EXIT.server, { status: w.res.status, details: { answer: b } });
  }
  const reply: ChatReply = {
    sessionId: b.sessionId,
    reply: typeof b.reply === 'string' ? b.reply : '',
    turn: typeof b.turn === 'number' ? b.turn : null,
    identifier: typeof b.identifier === 'string' ? b.identifier : t.identifier,
  };
  if (b.ui !== undefined) reply.ui = b.ui;
  return { sent: true, reply, raw: w.res.body };
}

function explain(e: unknown, t: TurnRequest): unknown {
  if (!(e instanceof CliError)) return e;
  let hint: string | undefined;
  if (e.status === 410) {
    hint = 'the session has ended on the server; send the message again without --session to start a new one';
  } else if (e.status === 409) {
    hint = 'a reply is still being written for this session; wait for it, then send again';
  } else if (e.status === 403 && /identifier/i.test(e.message)) {
    hint = 'a session answers only the identifier that started it: pass the same --identifier';
  } else if (e.exitCode === EXIT.network && t.sessionId === undefined && t.signal?.aborted !== true) {
    hint = 'if the server got the message, a session may be open without its id; it ends itself when idle';
  }
  if (!hint) return e;
  return new CliError(e.message, e.exitCode, { status: e.status, code: e.code, details: { ...e.details, hint } });
}

export async function endChat(ctx: CommandContext, sessionId: string): Promise<unknown> {
  const res = await ctx.api().send('POST', `/api/v1/chat/${encodeURIComponent(sessionId)}/end`);
  return res.body;
}
