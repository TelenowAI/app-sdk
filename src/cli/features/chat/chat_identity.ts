/**
 * chat_identity.ts — who the agent is talking to in a CLI chat: the `identifier` every turn sends.
 *
 * In here: `IDENTIFIER_OPTION` and `chatIdentifier`. The Chat API ties a session to an
 * `identifier`, the org's own id for the end user. Every later turn must send the same one, and
 * the server's pre-chat lookups may look that person up in the org's connected systems.
 * - By default the CLI sends `telenow-cli-` and 16 hex characters of a hash of this login's key
 *   (never the key, its hash as the server stores it, a machine name or a person's name). It is
 *   the same for every command run with the same key, so `chat send --session` continues a
 *   session that an earlier command started; and it matches nobody in a lookup.
 * - `--identifier <id>` chats as a particular end user: say, a test customer's id, so the
 *   lookups run for them. Use the same one on every turn of that session.
 * The server checks the length (1–128 characters).
 * Not in here: sending the turn (`chat_turn.ts`).
 * Called by: `send_chat.ts`, `chat_terminal.ts`.
 */

import { createHash } from 'node:crypto';

import { stringOption, type CommandContext, type OptionSpec } from '../../core/command_spec.js';

export const IDENTIFIER_OPTION: OptionSpec = {
  type: 'string',
  value: '<id>',
  help: 'the end user the agent sees (default: an id made from this login; the same on every turn)',
};

/** Hex characters of the hash kept: plenty to tell logins apart, short enough to read in a log. */
const HASH_CHARS = 16;

export function chatIdentifier(ctx: CommandContext): string {
  const given = stringOption(ctx.values, 'identifier');
  if (given !== undefined) return given;
  const digest = createHash('sha256').update('telenow-cli-chat\0').update(ctx.login().apiKey).digest('hex');
  return `telenow-cli-${digest.slice(0, HASH_CHARS)}`;
}
