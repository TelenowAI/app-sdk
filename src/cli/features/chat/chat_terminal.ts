/**
 * chat_terminal.ts — `telenow chat <agent-id>`: talk to an agent in this terminal.
 *
 * In here: `chatTerminalCommand` (TELENOW_CLI_PLAN.md §15.2 step 4b; decision D2).
 * - Needs a terminal. Scripts and AI assistants use `chat send`.
 * - It reads the agent first (`chat_agent.ts`). An agent that can phone people from a chat needs a
 *   typed yes (or `--yes`), and the agent's own tools are named, because they run for real.
 * - Each line typed is one turn (`chat_turn.ts`); the reply is printed as "<agent>: <text>",
 *   followed by what the agent attached (`reply_ui.ts`). When a reply offers options, typing an
 *   option's number picks it.
 * - `/end`, Ctrl-D or Ctrl-C ends the chat, and **the session is always ended on the server on the
 *   way out**: an open one keeps counting until it is idle long enough to end itself. Ctrl-C
 *   during a reply drops the request first.
 * - If the server has ended the session (410: idle, a restart, another server), the line is sent
 *   again in a new session, and the CLI says so.
 * - A refusal that will not change (the key, the agent, the identifier) stops the chat. Anything
 *   else is printed and the chat goes on.
 * - The answer to the confirm question and the messages come from ONE line reader: a second
 *   reader would drop lines that arrived together (a paste).
 * Output: the replies, then one line saying how the chat ended.
 * Not in here: one turn for a script (`send_chat.ts`).
 * Called by: `features/chat/register.ts`.
 */

import { createInterface } from 'node:readline';

import { CliError, errorJson, EXIT } from '../../core/cli_error.js';
import { boolOption, listOption, type CommandSpec } from '../../core/command_spec.js';
import { YES_OPTION } from '../../core/confirm_action.js';
import { variables } from '../calls/place_call.js';
import { readChatAgent } from './chat_agent.js';
import { chatIdentifier, IDENTIFIER_OPTION } from './chat_identity.js';
import { endChat, sendTurn, type TurnResult } from './chat_turn.js';
import { describeUi, replyOptions, type ReplyOption } from './reply_ui.js';

/** Refusals a retry cannot fix: stop the chat rather than ask again. */
function isFinal(e: unknown): boolean {
  return e instanceof CliError && (e.exitCode === EXIT.auth || e.exitCode === EXIT.notFound);
}

export const chatTerminalCommand: CommandSpec = {
  path: ['chat'],
  summary: 'talk to an agent in this terminal (scripts use chat send | messages | end)',
  args: ['agent-id'],
  options: {
    var: { type: 'string', value: '<name=value>', multiple: true, help: 'a variable for the session; repeat for more' },
    identifier: IDENTIFIER_OPTION,
    yes: YES_OPTION,
  },
  async run(ctx) {
    if (!ctx.io.stdinIsTTY) {
      throw new CliError('a chat in the terminal needs a terminal; scripts and AI assistants use `telenow chat send`', EXIT.usage);
    }
    const agentId = ctx.args['agent-id'];
    const identifier = chatIdentifier(ctx);
    const vars = variables(listOption(ctx.values, 'var'));
    const agent = await readChatAgent(ctx, agentId);
    const err = ctx.io.stderr;
    const out = ctx.io.stdout;
    const rl = createInterface({ input: ctx.io.stdin, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    const stop = new AbortController();
    const onSigint = () => {
      stop.abort();
      rl.close();
    };
    process.once('SIGINT', onSigint);
    let sessionId: string | undefined;
    let turns = 0;
    let ended = false;
    try {
      if (agent.canDial && !boolOption(ctx.values, 'yes')) {
        err.write(
          `${agent.name} can phone people from a chat: its follow-up calls are on for chat, so a reply may book a real ` +
            'call to whoever the conversation names (it rings a real phone and costs money)\nType yes and press Enter to go ahead:\n',
        );
        const answer = await lines.next();
        if (answer.done || answer.value.trim().toLowerCase() !== 'yes') {
          throw new CliError('cancelled; nothing was done', EXIT.usage, { code: 'cancelled' });
        }
      }
      if (agent.tools.length > 0) {
        err.write(`These tools of ${agent.name} run for real here: ${agent.tools.join(', ')} (and any installed app's).\n`);
      }
      err.write(`Chatting with ${agent.name}. Type a message and press Enter; /end, Ctrl-D or Ctrl-C ends the chat.\n`);
      let options: ReplyOption[] = [];
      while (!stop.signal.aborted) {
        const next = await lines.next();
        if (next.done) break;
        const text = next.value.trim();
        if (text === '') continue;
        if (text === '/end') break;
        let input = text;
        let optionId: string | undefined;
        const n = Number(text);
        if (options.length > 0 && Number.isInteger(n) && n >= 1 && n <= options.length) {
          input = options[n - 1].title;
          optionId = options[n - 1].id;
        }
        const turn = (sid: string | undefined) =>
          sendTurn(ctx, { agentId, identifier, input, sessionId: sid, variables: sid ? undefined : vars, optionId, signal: stop.signal });
        let res: TurnResult;
        try {
          res = await turn(sessionId);
        } catch (e) {
          if (stop.signal.aborted) break;
          if (e instanceof CliError && e.status === 410 && sessionId !== undefined) {
            err.write('The session had ended on the server; sending this message in a new one.\n');
            sessionId = undefined;
            try {
              res = await turn(undefined);
            } catch (e2) {
              if (stop.signal.aborted || isFinal(e2)) throw e2;
              err.write(JSON.stringify(e2 instanceof CliError ? errorJson(e2) : { error: { message: String(e2) } }) + '\n');
              continue;
            }
          } else if (isFinal(e)) {
            throw e;
          } else {
            err.write(JSON.stringify(e instanceof CliError ? errorJson(e) : { error: { message: String(e) } }) + '\n');
            continue;
          }
        }
        if (!res.sent) continue;
        sessionId = res.reply.sessionId;
        turns++;
        options = replyOptions(res.reply.ui);
        out.write(`${agent.name}: ${res.reply.reply}\n`);
        const extra = describeUi(res.reply.ui);
        if (extra) out.write(extra + '\n');
        if (options.length > 0) err.write('(type a number to pick one)\n');
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
      rl.close();
      if (sessionId !== undefined) {
        try {
          await endChat(ctx, sessionId);
          ended = true;
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          err.write(`Could not end the session ${sessionId} (${why}); run telenow chat end ${sessionId}\n`);
        }
      }
    }
    if (sessionId === undefined) return { text: 'The chat ended before any reply.' };
    return {
      text: ended
        ? `Chat ended after ${turns} ${turns === 1 ? 'turn' : 'turns'} (session ${sessionId}).`
        : `Chat left open after ${turns} ${turns === 1 ? 'turn' : 'turns'} (session ${sessionId}).`,
    };
  },
};
