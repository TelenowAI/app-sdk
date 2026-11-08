/**
 * cli_error.ts — the CLI's one error type and the exit codes it promises.
 *
 * In here: `EXIT` (the exit codes in TELENOW_CLI_PLAN.md §6), `CliError` (what any command
 * throws to stop with a message), `exitCodeForStatus` (an HTTP status → an exit code) and
 * `errorJson` (the `{"error":{…}}` object printed on stderr).
 * Not in here: turning a server response into a `CliError` (`api_client.ts`), printing it
 * (`main.ts`).
 * Called by: every command, `api_client.ts`, `main.ts`.
 */

export const EXIT = {
  ok: 0,
  /** Bad command or input, or a check the CLI itself refused. */
  usage: 1,
  /** Not signed in, or the key's role may not do this (401 / 403). */
  auth: 2,
  /** 404, including a module that is switched off on this server. */
  notFound: 3,
  /** 409: someone else changed the thing since it was read. */
  conflict: 4,
  /** 429 after the retries the client allows. */
  rateLimited: 5,
  /** 5xx. */
  server: 6,
  /** The server could not be reached, or did not answer in time. */
  network: 7,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CliErrorExtra {
  status?: number;
  code?: string;
  /** Extra fields from the server's error body (for example `currentVersion` on a 409). */
  details?: Record<string, unknown>;
}

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly status?: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, exitCode: ExitCode, extra: CliErrorExtra = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.status = extra.status;
    this.code = extra.code;
    this.details = extra.details;
  }
}

export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401 || status === 403) return EXIT.auth;
  if (status === 404) return EXIT.notFound;
  if (status === 409) return EXIT.conflict;
  if (status === 429) return EXIT.rateLimited;
  if (status >= 500) return EXIT.server;
  return EXIT.usage;
}

export function errorJson(e: CliError): { error: Record<string, unknown> } {
  const error: Record<string, unknown> = { message: e.message };
  if (e.status !== undefined) error.status = e.status;
  if (e.code !== undefined) error.code = e.code;
  if (e.details) Object.assign(error, e.details);
  return { error };
}
