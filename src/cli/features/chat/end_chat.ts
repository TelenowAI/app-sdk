/**
 * end_chat.ts — `telenow chat end <session-id>`: end an open chat session.
 *
 * In here: `endChatCommand` → `POST /api/v1/chat/:id/end` → `{ sessionId, ended }`.
 * Ending settles the session's bill and runs its after-call analysis; it answers 200 even for a
 * session that has already ended. The server refuses (404) anything that is not a Chat API
 * session, so this never hangs up a phone call. `--dry-run` shows the request.
 * Not in here: starting one (`send_chat.ts`, `chat_terminal.ts`).
 * Called by: `features/chat/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';

export const endChatCommand: CommandSpec = {
  path: ['chat', 'end'],
  summary: 'end an open chat session',
  args: ['session-id'],
  options: { 'dry-run': DRY_RUN_OPTION },
  async run(ctx) {
    const id = ctx.args['session-id'];
    const w = await sendWrite(ctx, { method: 'POST', path: `/api/v1/chat/${encodeURIComponent(id)}/end` });
    if (!w.sent) return { data: w.dryRun };
    return { data: w.res.body, raw: w.res.body };
  },
};
