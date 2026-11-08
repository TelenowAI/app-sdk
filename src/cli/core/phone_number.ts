/**
 * phone_number.ts — read a phone number the CLI is about to dial or list.
 *
 * In here: `e164`. Spaces, dashes, dots and brackets are dropped (people type "+91 98765-43210");
 * what is left must be E.164: a `+`, then 8 to 15 digits, the first not 0 (ITU-T E.164 allows
 * at most 15). The immediate-call route hands the number to the carrier as it is, so a number
 * that is not E.164 is refused here rather than mis-dialled there.
 * Not in here: do-not-call, consent or calling-hours checks — the server's.
 * Called by: `features/calls/place_call.ts`, `features/dnc/add_dnc.ts`.
 */

import { CliError, EXIT } from './cli_error.js';

const E164 = /^\+[1-9]\d{7,14}$/;

export function e164(raw: string, what: string): string {
  const n = raw.replace(/[\s\-.()]/g, '');
  if (!E164.test(n)) {
    throw new CliError(`${what} '${raw}' is not an international number: write it as + then the country code, e.g. +919876543210`, EXIT.usage);
  }
  return n;
}
