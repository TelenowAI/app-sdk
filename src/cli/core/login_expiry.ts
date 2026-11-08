/**
 * login_expiry.ts — "this login expired on …" instead of a bare 401, and the note at login.
 *
 * In here: `LoginExpiry` (what the client knows about the saved key's expiry), `expiredLoginError`
 * and `expiryNote`. A browser login's key expires (CLI_BROWSER_LOGIN_PLAN.md §3.9, decision 4:
 * `CLI_LOGIN_KEY_TTL_DAYS`, 90 by default), and the profile saves when. When a request made with
 * that SAVED key gets 401 and that time has passed, the error says so and how to sign in again
 * (code `login_expired`, still exit 2); the server's own message is kept in `serverMessage`.
 * A key from TELENOW_API_KEY, a key being checked by `telenow login`, a profile without an
 * expiry, or a 401 before the expiry keep the server's message as it is.
 * Not in here: sending and the 401 itself (`api_client.ts`), which profile is used
 * (`resolve_login.ts`), saving the expiry (`features/auth/login.ts`).
 * Called by: `api_client.ts`, `command_context.ts`, `features/auth/login.ts`.
 */

import { CliError, EXIT } from './cli_error.js';

export interface LoginExpiry {
  /** ISO time the saved key stops working. */
  expiresAt: string;
  /** The profile that holds the key, for the "run `telenow login`" hint. */
  profile: string;
}

/** The day part of an ISO time (UTC), which is what a person needs to read. */
function day(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function loginCommand(profile: string): string {
  return profile === 'default' ? 'telenow login' : `telenow login --profile ${profile}`;
}

export function expiredLoginError(e: CliError, expiry: LoginExpiry | undefined, now: number): CliError | undefined {
  if (e.status !== 401 || !expiry) return undefined;
  const at = Date.parse(expiry.expiresAt);
  if (!Number.isFinite(at) || at > now) return undefined;
  return new CliError(`this login expired on ${day(expiry.expiresAt)}; run \`${loginCommand(expiry.profile)}\``, EXIT.auth, {
    status: e.status,
    code: 'login_expired',
    details: { expiresAt: expiry.expiresAt, profile: expiry.profile, serverMessage: e.message },
  });
}

/** The stderr note `telenow login` prints when the new key has an expiry. */
export function expiryNote(expiry: LoginExpiry): { note: string; expiresAt: string } {
  return {
    note: `this login expires on ${day(expiry.expiresAt)}; then run \`${loginCommand(expiry.profile)}\` again`,
    expiresAt: expiry.expiresAt,
  };
}
