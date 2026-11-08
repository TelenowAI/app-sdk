/**
 * send_chat.ts — `telenow chat send <agent-id> --message <text>`: one turn of a text chat, for
 * scripts and AI assistants.
 *
 * In here: `sendChatCommand` (TELENOW_CLI_PLAN.md §15.2 step 4b; decision D2).
 * - Without `--session` it starts a session. It reads the agent first (`chat_agent.ts`): an agent
 *   that can phone people from a chat needs a typed yes, or `--yes`. After the reply the CLI
 *   **ends the session** (`chat_turn.ts`), because an open one keeps counting until it is idle
 *   long enough to end itself. `--keep` leaves it open and prints the id to continue with.
 * - `--session <id>` continues an open session and leaves it open; `--end` ends it after this
 *   turn. `--var` is refused with `--session`: variables count on the first turn only.
 * - `--option <id>` answers one of the options the last reply's `ui` offered (`--message` is then
 *   that option's title).
 * - Output: `{ sessionId, reply, turn, ui?, ended }`. If the reply came but ending the session
 *   failed, the reply is still printed, with `ended: false` and a warning.
 * - `--dry-run` shows the request; nothing is read or sent. `--idempotency-key` retries a turn
 *   once only.
 * Not in here: a conversation in the terminal (`chat_terminal.ts`).
 * Called by: `features/chat/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, listOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, isDryRun } from '../../core/write_request.js';
import { variables } from '../calls/place_call.js';
import { confirmChatRisks, readChatAgent } from './chat_agent.js';
import { chatIdentifier, IDENTIFIER_OPTION } from './chat_identity.js';
import { endChat, sendTurn } from './chat_turn.js';

export const sendChatCommand: CommandSpec = {
  path: ['chat', 'send'],
  summary: 'send one chat message to an agent and print its reply (ends the session unless --keep)',
  args: ['agent-id'],
  options: {
    message: { type: 'string', value: '<text>', help: 'what the person says' },
    session: { type: 'string', value: '<session-id>', help: 'continue this open session (it stays open; --end ends it)' },
    keep: { type: 'boolean', help: 'leave the new session open, to continue it with --session' },
    end: { type: 'boolean', help: 'end the session given with --session after this reply' },
    option: { type: 'string', value: '<option-id>', help: "answer one of the last reply's options (--message: its title)" },
    var: { type: 'string', value: '<name=value>', multiple: true, help: 'a variable for a new session; repeat for more' },
    identifier: IDENTIFIER_OPTION,
    yes: YES_OPTION,
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const v = ctx.values;
    const agentId = ctx.args['agent-id'];
    const message = stringOption(v, 'message');
    if (message === undefined || message.trim() === '') throw new CliError('--message is required', EXIT.usage);
    const sessionId = stringOption(v, 'session');
    const vars = variables(listOption(v, 'var'));
    if (sessionId !== undefined && vars !== undefined) {
      throw new CliError('--var counts on the first turn of a session only; leave it out with --session', EXIT.usage);
    }
    if (sessionId !== undefined && boolOption(v, 'keep')) {
      throw new CliError('a session given with --session stays open anyway; --keep is for a new one', EXIT.usage);
    }
    if (sessionId === undefined && boolOption(v, 'end')) {
      throw new CliError('a new session is ended after its reply anyway (unless --keep); --end is for --session', EXIT.usage);
    }
    const turn = {
      agentId,
      identifier: chatIdentifier(ctx),
      input: message,
      sessionId,
      variables: vars,
      optionId: stringOption(v, 'option'),
    };
    if (isDryRun(ctx)) {
      const dry = await sendTurn(ctx, turn);
      return { data: dry.sent ? null : dry.dryRun };
    }
    const notes: unknown[] = [];
    if (sessionId === undefined) notes.push(...(await confirmChatRisks(ctx, await readChatAgent(ctx, agentId))));
    const res = await sendTurn(ctx, turn);
    if (!res.sent) return { data: res.dryRun };
    const r = res.reply;
    const shouldEnd = sessionId === undefined ? !boolOption(v, 'keep') : boolOption(v, 'end');
    let ended = false;
    if (shouldEnd) {
      try {
        await endChat(ctx, r.sessionId);
        ended = true;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        notes.push({ warning: `the reply came, but the session could not be ended (${why}); run telenow chat end ${r.sessionId}` });
      }
    } else {
      notes.push({ next: `telenow chat send ${agentId} --session ${r.sessionId} --message "…"` });
      notes.push({ note: `the session stays open until telenow chat end ${r.sessionId}, or until it has been idle long enough to end itself` });
    }
    const data: Record<string, unknown> = { sessionId: r.sessionId, reply: r.reply, turn: r.turn };
    if (r.ui !== undefined) data.ui = r.ui;
    data.ended = ended;
    return { data, raw: res.raw, notes };
  },
};
