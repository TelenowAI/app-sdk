/**
 * provider_arg.ts — `--provider` for the voice commands.
 *
 * In here: `providerArg`: required, and only letters, digits, `.`, `_`, `-` (it goes into a path).
 * Not in here: which providers exist — the server's catalog (`GET /api/catalog`).
 * Called by: `list_voices.ts`, `list_clones.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function providerArg(raw: string | undefined): string {
  if (!raw) throw new CliError('--provider is required (e.g. the ttsProvider of an agent: telenow agents get <id> --fields tts_provider)', EXIT.usage);
  if (!SAFE.test(raw)) throw new CliError(`'${raw}' is not a provider name`, EXIT.usage);
  return raw;
}
