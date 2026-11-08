/**
 * local_timezone.ts — the time zone a command's `--from` / `--to` days are meant in.
 *
 * In here: `TZ_OPTION` and `timeZoneFor`: `--tz <zone>` when given, else this computer's zone
 * (the `TZ` variable when it names a zone, else the system's), as an IANA name. The call routes
 * read days in the zone they are sent, and default to the server's own zone when none is sent —
 * so "--from 2026-11-01" would silently mean a different midnight than the person meant.
 * `undefined` only when the computer reports no zone at all; then nothing is sent.
 * Not in here: checking the zone (the server refuses an unknown one with 400).
 * Called by: `features/calls/list_calls.ts`, `features/calls/export_calls.ts`.
 */

import { stringOption, type CommandContext, type OptionSpec } from './command_spec.js';

export const TZ_OPTION: OptionSpec = {
  type: 'string',
  value: '<zone>',
  help: "time zone the days are in, e.g. Europe/London (default: this computer's)",
};

export function timeZoneFor(ctx: CommandContext): string | undefined {
  return stringOption(ctx.values, 'tz') ?? machineTimeZone(ctx.env.TZ);
}

function machineTimeZone(tzVar: string | undefined): string | undefined {
  if (tzVar && tzVar.trim() !== '') {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tzVar.trim() }).resolvedOptions().timeZone;
    } catch {
      // Not a zone name (a POSIX rule such as "EST5EDT,M3.2.0,M11.1.0"): use the system's.
    }
  }
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && zone.trim() !== '' ? zone : undefined;
}
