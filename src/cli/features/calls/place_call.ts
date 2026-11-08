/**
 * place_call.ts — `telenow call place --agent <id> --to <+number>`: dial one person with an agent.
 *
 * In here: `placeCallCommand` → `POST /api/sessions/initiate-call`. It DIALS A REAL PHONE AND
 * COSTS MONEY, so it reads the agent (for its name), says exactly who is called, by which agent,
 * from which number, and asks — or needs `--yes` (`core/confirm_action.ts`). `--dry-run` shows the
 * request without asking or sending. Every request carries an Idempotency-Key: pass the same
 * `--idempotency-key` when retrying after a timeout, and the server answers the first call's
 * result instead of dialling again.
 *
 * Two modes:
 * - immediate (default): the server dials now and answers `{ sessionId, status, callStatus,
 *   callId, phoneNumber }` (201). This route checks the do-not-call list, consent, credits and
 *   limits — but NOT the callee's local calling hours; the question says so.
 * - `--queue`: the server queues it (202 `{ queued, campaignId, pendingAhead }`) and its campaign
 *   worker dials when allowed, re-checking do-not-call and the calling window; `--retries` sets
 *   how many attempts (the server clamps it).
 *
 * Body fields sent: `agentId`, `mobileNumber` (E.164, `core/phone_number.ts`), `fromNumber` or
 * `fromNumberId`, `variables` (`--var name=value`, repeatable), `firstResponse`,
 * `machineDetection`, `queue`, `maxAttempts`.
 * Also `variables`, the `--var name=value` reader the chat commands share.
 * Not in here: following the call (`telenow calls get <sessionId>`).
 * Called by: `features/calls/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, intOption, listOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { e164 } from '../../core/phone_number.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, isDryRun, sendWrite } from '../../core/write_request.js';

/** `--var name=value` pairs as call variables; `features/chat` reads its `--var` with it too. */
export function variables(pairs: string[]): Record<string, string> | undefined {
  if (pairs.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i <= 0) throw new CliError(`--var must be name=value (got '${p}')`, EXIT.usage);
    out[p.slice(0, i).trim()] = p.slice(i + 1);
  }
  return out;
}

export const placeCallCommand: CommandSpec = {
  path: ['call', 'place'],
  summary: 'dial one person with an agent — a real call that costs money (asks first, or --yes)',
  options: {
    agent: { type: 'string', value: '<agent-id>', help: 'the agent that talks (required)' },
    to: { type: 'string', value: '<+number>', help: 'who is called, as + country code number (required)' },
    from: { type: 'string', value: '<+number>', help: "caller id: one of the org's numbers (default: the server picks)" },
    'from-number-id': { type: 'string', value: '<id>', help: 'caller id by number id instead of --from' },
    var: { type: 'string', value: '<name=value>', multiple: true, help: 'a call variable; repeat for more' },
    'first-response': { type: 'string', value: '<text>', help: "the agent's opening line for this call" },
    'machine-detection': { type: 'string', value: '<mode>', help: 'hangup / drop, or on (voicemail detection)' },
    queue: { type: 'boolean', help: 'queue it: dialled when allowed, calling hours checked' },
    retries: { type: 'string', value: '<n>', help: 'with --queue: attempts in all' },
    yes: YES_OPTION,
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const v = ctx.values;
    const agentId = stringOption(v, 'agent');
    const toRaw = stringOption(v, 'to');
    if (!agentId) throw new CliError('--agent is required', EXIT.usage);
    if (!toRaw) throw new CliError('--to is required', EXIT.usage);
    const to = e164(toRaw, '--to');
    const fromRaw = stringOption(v, 'from');
    const fromId = stringOption(v, 'from-number-id');
    if (fromRaw && fromId) throw new CliError('give --from or --from-number-id, not both', EXIT.usage);
    const from = fromRaw ? e164(fromRaw, '--from') : undefined;
    const queue = boolOption(v, 'queue');
    const retries = intOption(v, 'retries', 1);
    if (retries !== undefined && !queue) throw new CliError('--retries works with --queue only', EXIT.usage);
    const body = {
      agentId,
      mobileNumber: to,
      fromNumber: from,
      fromNumberId: fromId,
      variables: variables(listOption(v, 'var')),
      firstResponse: stringOption(v, 'first-response'),
      machineDetection: stringOption(v, 'machine-detection'),
      queue: queue || undefined,
      maxAttempts: retries,
    };
    if (!isDryRun(ctx)) {
      const agent = dataOf((await ctx.api().get(`/api/agents/${encodeURIComponent(agentId)}`)).body) as { name?: unknown } | null;
      const name = typeof agent?.name === 'string' ? agent.name : agentId;
      const caller = from ?? (fromId ? `number id ${fromId}` : "the agent's or org's default number");
      await confirmAction(
        ctx,
        queue
          ? `Queue a call to ${to} by agent "${name}" from ${caller}. It is dialled when the calling window allows, and costs money.`
          : `Call ${to} now, by agent "${name}", from ${caller}. This dials a real phone and costs money. ` +
              "The callee's local calling hours are NOT checked on an immediate call (--queue checks them).",
      );
    }
    const w = await sendWrite(ctx, { method: 'POST', path: '/api/sessions/initiate-call', body, creates: true });
    if (!w.sent) return { data: w.dryRun };
    const d = dataOf(w.res.body) as { sessionId?: unknown } | null;
    const replay = w.res.headers.get('idempotent-replay') === 'true';
    const notes: unknown[] = [];
    if (replay) notes.push({ note: 'this Idempotency-Key was used before: the server answered the first request again; nothing new was dialled' });
    if (typeof d?.sessionId === 'string') notes.push({ next: `telenow calls get ${d.sessionId}` });
    return { data: d, raw: w.res.body, notes };
  },
};
