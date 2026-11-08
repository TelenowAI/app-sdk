/**
 * register.ts — the chat commands: talk to an agent by text (the Chat API, `/api/v1/chat`).
 *
 * Files in this folder:
 *   chat_terminal.ts  telenow chat <agent-id>   a conversation in this terminal (ended on the way out)
 *   send_chat.ts      telenow chat send         one turn, for scripts (ends the session unless --keep)
 *   chat_messages.ts  telenow chat messages     what was said in a session
 *   end_chat.ts       telenow chat end          end an open session
 *   chat_turn.ts      one turn and ending a session, shared
 *   chat_agent.ts     what the agent can do for real in a chat; the ask when it can phone people
 *   chat_identity.ts  the `identifier` every turn sends
 *   reply_ui.ts       the options, link or file a reply carries, as text
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { chatMessagesCommand } from './chat_messages.js';
import { chatTerminalCommand } from './chat_terminal.js';
import { endChatCommand } from './end_chat.js';
import { sendChatCommand } from './send_chat.js';

export const chatCommands: CommandSpec[] = [chatTerminalCommand, sendChatCommand, chatMessagesCommand, endChatCommand];
