/**
 * number_requirements.ts — `telenow numbers requirements --country --type --end-user`: the
 * documents a carrier needs before it sells a number in a regulated country.
 *
 * In here: `requirementsCommand` → `GET /api/voice/numbers/compliance/requirements?country&type&
 * endUserType[&provider]` → `{ provider, requirements: [{ document_type_id, name, description,
 * proof_required, data_fields, required_fields, raw }] }`. The short view leaves out the
 * carrier's `raw` detail; `--full` keeps it. Only some carriers support this; the others answer
 * 400, printed as it is.
 * Sending the documents is not offered: they carry a person's identity papers to the carrier and
 * cannot be recalled, so they stay in the dashboard (TELENOW_CLI_PLAN.md §15.2).
 * Not in here: buying (`buy_number.ts`, which takes the accepted application's id).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';

const REQUIREMENT_VIEW = ['document_type_id', 'name', 'description', 'proof_required', 'required_fields'];

export const requirementsCommand: CommandSpec = {
  path: ['numbers', 'requirements'],
  summary: 'list the documents a carrier needs before it sells a number in a country',
  options: {
    country: { type: 'string', value: '<CC>', help: 'two-letter country code, e.g. DE' },
    type: { type: 'string', value: '<type>', help: 'number type, e.g. local, mobile, tollfree' },
    'end-user': { type: 'string', value: '<type>', help: 'who will use it, e.g. business or individual' },
    provider: { type: 'string', value: '<id>', help: 'the carrier (default: the org default)' },
    full: { type: 'boolean', help: "print whole rows, the carrier's own detail included" },
  },
  async run(ctx) {
    const v = ctx.values;
    const missing = ['country', 'type', 'end-user'].filter((n) => stringOption(v, n) === undefined);
    if (missing.length > 0) throw new CliError(`${missing.map((n) => `--${n}`).join(', ')} required`, EXIT.usage);
    const res = await ctx.api().get('/api/voice/numbers/compliance/requirements', {
      query: {
        country: stringOption(v, 'country'),
        type: stringOption(v, 'type'),
        endUserType: stringOption(v, 'end-user'),
        provider: stringOption(v, 'provider'),
      },
    });
    const d = (dataOf(res.body) ?? {}) as { provider?: unknown; requirements?: unknown };
    return {
      data: Array.isArray(d.requirements) ? d.requirements : [],
      raw: res.body,
      defaultFields: boolOption(v, 'full') ? undefined : REQUIREMENT_VIEW,
      notes: [{ provider: d.provider ?? null }],
    };
  },
};
