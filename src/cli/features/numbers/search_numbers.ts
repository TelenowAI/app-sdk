/**
 * search_numbers.ts — `telenow numbers search --country <CC> …`: numbers a carrier has for sale now.
 *
 * In here:
 * - `searchNumbersCommand` → `GET /api/voice/numbers/search`. Searching is free: it asks the
 *   carrier's inventory and buys nothing.
 * - `SEARCH_OPTIONS` and `searchNumbers`, which `buy_number.ts` shares. A purchase repeats the
 *   search that showed the number, to price it (decision D3).
 * - The query takes `country` (required), `provider`, `pattern` and `match` (starts, contains or
 *   ends; how far each carrier honours it differs, e.g. Twilio has no "ends"), `type`, `region`,
 *   `limit` and `offset`.
 * - The answer is `{ provider, numbers: [{ e164, region, number_type, monthly_rent, setup_price,
 *   capabilities, raw, price_currency, monthly_rent_usd, setup_price_usd }], meta }`. Prices come
 *   in the carrier's currency, with USD beside them when a rate is known. The short view leaves
 *   out `raw`, and `provider` is printed as a note.
 * - A carrier not open to the org is 403, printed as it is.
 * Not in here: buying (`buy_number.ts`).
 * Called by: `features/numbers/register.ts`, `buy_number.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, intOption, oneOf, stringOption, type CommandContext, type CommandSpec, type OptionSpec } from '../../core/command_spec.js';

export const SEARCH_OPTIONS: Record<string, OptionSpec> = {
  country: { type: 'string', value: '<CC>', help: 'two-letter country code, e.g. US (required)' },
  provider: { type: 'string', value: '<id>', help: 'the carrier (default: the org default; see numbers providers)' },
  pattern: { type: 'string', value: '<digits>', help: 'digits the number should have' },
  match: { type: 'string', value: '<where>', help: 'where the digits are: starts, contains (default) or ends' },
  type: { type: 'string', value: '<type>', help: 'number type, e.g. local, mobile, tollfree' },
  region: { type: 'string', value: '<region>', help: 'a state or region the carrier knows' },
  limit: { type: 'string', value: '<n>', help: 'how many to ask for (the carrier caps it)' },
  offset: { type: 'string', value: '<n>', help: 'skip this many first' },
};

const MATCHES = ['starts', 'contains', 'ends'] as const;
const SEARCH_VIEW = ['e164', 'region', 'number_type', 'monthly_rent', 'setup_price', 'price_currency', 'monthly_rent_usd', 'setup_price_usd', 'capabilities'];

export interface FoundNumber {
  e164: string;
  number_type?: string | null;
  region?: string | null;
  monthly_rent?: string | null;
  setup_price?: string | null;
  price_currency?: string | null;
  monthly_rent_usd?: string | null;
  setup_price_usd?: string | null;
  [k: string]: unknown;
}

export interface SearchAnswer {
  provider: string | null;
  numbers: FoundNumber[];
  raw: unknown;
}

export async function searchNumbers(ctx: CommandContext): Promise<SearchAnswer> {
  const v = ctx.values;
  const country = stringOption(v, 'country');
  if (country === undefined) throw new CliError('--country is required (two letters, e.g. US)', EXIT.usage);
  const res = await ctx.api().get('/api/voice/numbers/search', {
    query: {
      country,
      provider: stringOption(v, 'provider'),
      pattern: stringOption(v, 'pattern'),
      match: oneOf(v, 'match', MATCHES),
      type: stringOption(v, 'type'),
      region: stringOption(v, 'region'),
      limit: intOption(v, 'limit', 1),
      offset: intOption(v, 'offset', 0),
    },
  });
  const d = (dataOf(res.body) ?? {}) as { provider?: unknown; numbers?: unknown };
  const numbers = Array.isArray(d.numbers) ? (d.numbers as FoundNumber[]).filter((n) => typeof n?.e164 === 'string') : [];
  return { provider: typeof d.provider === 'string' ? d.provider : null, numbers, raw: res.body };
}

export const searchNumbersCommand: CommandSpec = {
  path: ['numbers', 'search'],
  summary: 'search a carrier for numbers to buy (free; buys nothing)',
  options: { ...SEARCH_OPTIONS, full: { type: 'boolean', help: "print whole rows, the carrier's own detail included" } },
  async run(ctx) {
    const found = await searchNumbers(ctx);
    return {
      data: found.numbers,
      raw: found.raw,
      defaultFields: boolOption(ctx.values, 'full') ? undefined : SEARCH_VIEW,
      notes: [{ provider: found.provider }],
    };
  },
};
