/**
 * buy_number.ts — `telenow numbers buy <+number> --country <CC> [the search's options]`: rent a
 * number. IT SPENDS MONEY: the setup fee and the first month now, then every month until it is
 * released.
 *
 * In here: `buyNumberCommand` (TELENOW_CLI_PLAN.md §15.3, decision D3).
 * 1. It runs the search again, with the same options as the search that showed the number
 *    (`search_numbers.ts`), and finds the exact number in the answer. If the number is not there
 *    (sold, or the options differ), it stops: exit 3, nothing bought.
 * 2. The price comes from that answer, in the carrier's currency, with USD when known. The CLI
 *    never takes a typed price. A number the carrier gives no rent for is refused (exit 1
 *    `no_price`): there would be nothing true to show. A missing setup fee is said to be missing,
 *    never shown as 0.
 * 3. The question states the number, the carrier, the type and region, the setup fee and first
 *    month, and that it renews monthly. It needs a typed yes, or `--yes` without a terminal.
 * 4. `POST /api/voice/numbers/purchase` with `{ number, provider (the carrier that answered the
 *    search), extras: { monthlyRent, setupPrice, numberType }, complianceApplicationId? }` and an
 *    Idempotency-Key. A retry with the same `--idempotency-key` gets the first answer back, not a
 *    second number. The server bills the carrier's own price when the carrier states one, and
 *    these search prices only when it does not.
 * The answer (201) is `{ number, integrationExternalId, providerStatus, complianceLinked }`. It does
 * NOT say what was charged (backend finding B1), so the output repeats the price that was shown.
 * Refusals print as they are: 403 (suspended, out of credit, a cap, a carrier not open to the
 * org), 409 (already owned), a carrier's own refusal, and a regulated country without an accepted
 * `--compliance` application.
 * `--dry-run` runs the free search and shows the purchase request; it never asks or buys.
 * Not in here: giving it back (`release_number.ts`).
 * Called by: `features/numbers/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { confirmAction, YES_OPTION } from '../../core/confirm_action.js';
import { e164 } from '../../core/phone_number.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, isDryRun, replayNotes, sendWrite } from '../../core/write_request.js';
import { SEARCH_OPTIONS, searchNumbers, type FoundNumber } from './search_numbers.js';

const digits = (s: string) => s.replace(/\D/g, '');

function money(amount: string | null | undefined, currency: string | null | undefined, usd: string | null | undefined): string {
  const native = `${amount} ${currency ?? ''}`.trim();
  return usd && currency !== 'USD' ? `${native} (about ${usd} USD)` : native;
}

export const buyNumberCommand: CommandSpec = {
  path: ['numbers', 'buy'],
  summary: 'rent a number found with numbers search (costs money now and monthly; asks first)',
  args: ['number'],
  options: {
    ...SEARCH_OPTIONS,
    compliance: { type: 'string', value: '<application-id>', help: 'an accepted compliance application, for a regulated country' },
    yes: YES_OPTION,
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const wanted = e164(ctx.args['number'], 'the number to buy');
    const found = await searchNumbers(ctx);
    const hit: FoundNumber | undefined = found.numbers.find((n) => digits(n.e164) === digits(wanted));
    if (!hit) {
      throw new CliError(
        `${wanted} is not among the numbers this search finds now (${found.numbers.length} found): it may be sold, or ` +
          'the options differ from the search that showed it. Nothing was bought.',
        EXIT.notFound,
        { code: 'not_offered' },
      );
    }
    if (!hit.monthly_rent) {
      throw new CliError(`the carrier gives no monthly price for ${wanted}, so there is no price to agree to; nothing was bought`, EXIT.usage, {
        code: 'no_price',
      });
    }
    const setup = hit.setup_price ?? null;
    const extras: Record<string, string> = { monthlyRent: hit.monthly_rent };
    if (setup) extras.setupPrice = setup;
    if (hit.number_type) extras.numberType = hit.number_type;
    const body: Record<string, unknown> = { number: hit.e164, extras };
    if (found.provider) body.provider = found.provider;
    const compliance = stringOption(ctx.values, 'compliance');
    if (compliance !== undefined) body.complianceApplicationId = compliance;
    const price = {
      provider: found.provider,
      currency: hit.price_currency ?? null,
      setupPrice: setup,
      monthlyRent: hit.monthly_rent,
      setupPriceUsd: hit.setup_price_usd ?? null,
      monthlyRentUsd: hit.monthly_rent_usd ?? null,
    };
    const req = { method: 'POST' as const, path: '/api/voice/numbers/purchase', body, creates: true };
    if (isDryRun(ctx)) {
      const w = await sendWrite(ctx, req);
      return { data: w.sent ? null : { ...w.dryRun, price } };
    }
    const what = [hit.number_type, hit.region].filter((x) => typeof x === 'string' && x !== '').join(', ');
    await confirmAction(
      ctx,
      `Buying ${hit.e164}${what ? ` (${what})` : ''} from ${found.provider ?? 'the default carrier'}: ` +
        (setup ? `setup ${money(setup, price.currency, price.setupPriceUsd)} and the first month ` : 'the first month ') +
        `${money(hit.monthly_rent, price.currency, price.monthlyRentUsd)} are charged to your account now, ` +
        'and it renews every month until you release it' +
        (setup ? '' : ' (the carrier states no setup fee)'),
    );
    const w = await sendWrite(ctx, req);
    if (!w.sent) return { data: w.dryRun };
    const d = (dataOf(w.res.body) ?? {}) as Record<string, unknown>;
    return {
      data: { ...d, price },
      raw: w.res.body,
      notes: [...replayNotes(w.res), { note: "the server's answer does not say what was charged; `price` is the one shown before buying" }],
    };
  },
};
