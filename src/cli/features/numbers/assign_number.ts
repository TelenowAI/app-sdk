/**
 * assign_number.ts — `telenow numbers assign <number-id> --agent <agent-id>`: make an agent answer
 * calls to a number.
 *
 * In here: `assignNumberCommand` → `POST /api/voice/numbers/:id/assign-agent` with `{ agentId }`.
 * The server MOVES the number: it takes it from any agent that had it, and it always clears the
 * number's default-outbound flag and its inbound action, even when the agent stays the same. So
 * the CLI reads the number first (`number_row.ts`):
 * - already this agent's → nothing is sent, so nothing is cleared silently;
 * - taken from another agent, or a setting cleared → the question names each change, and it needs
 *   a typed yes (or `--yes`);
 * - a number with no agent and no settings → sent without asking.
 * It is reversible, unlike a release. The server refuses an agent of another org (403) or a number
 * a team member holds for inbound calls (409). `--dry-run` shows the request.
 * Not in here: taking the agent off (`unassign_number.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { DRY_RUN_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';
import { agentLabel, NUMBER_VIEW, numberPath, readNumber } from './number_row.js';

export const assignNumberCommand: CommandSpec = {
  path: ['numbers', 'assign'],
  summary: 'make an agent answer calls to a number (asks first if it moves or clears anything)',
  args: ['number-id'],
  options: {
    agent: { type: 'string', value: '<agent-id>', help: 'the agent to answer it' },
    yes: YES_OPTION,
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const id = ctx.args['number-id'];
    const agentId = stringOption(ctx.values, 'agent');
    if (!agentId) throw new CliError('--agent <agent-id> is required', EXIT.usage);
    const req = { method: 'POST' as const, path: numberPath(id, '/assign-agent'), body: { agentId } };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : w.dryRun };
    }
    const n = await readNumber(ctx, id);
    if (n.agent_id === agentId) {
      return { data: n, defaultFields: NUMBER_VIEW, notes: [{ note: `${n.e164} is already this agent's; nothing was sent` }] };
    }
    const changes: string[] = [];
    if (n.agent_id) changes.push(`it is taken from ${await agentLabel(ctx, n.agent_id)}, which stops answering it`);
    if (n.is_pool) changes.push('it is a pool number: its agent is who answers when routing finds nobody');
    if (n.is_default_outbound) changes.push('it stops being a default number for outbound calls');
    if (n.inbound_action) changes.push(`its inbound action (${n.inbound_action}) is cleared`);
    if (changes.length > 0) {
      await confirmAction(ctx, `Assigning ${n.e164} to ${await agentLabel(ctx, agentId)}: ${changes.join('; ')}`);
    }
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body, defaultFields: NUMBER_VIEW };
  },
};
