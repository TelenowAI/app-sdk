/**
 * cli_version.ts — the package version, and the User-Agent the CLI sends.
 *
 * In here: `cliVersion` (read from the `telenow` package's own package.json, three folders up
 * from this file in both src/ and dist/) and `userAgent`
 * (`telenow-cli/<version> (node <v>; <platform>)`), so the server can see CLI traffic and
 * which versions still call a route before it changes.
 * Not in here: anything else about the request (`api_client.ts`).
 * Called by: `main.ts`, `command_context.ts`.
 */

import { readFileSync } from 'node:fs';

export function cliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function userAgent(): string {
  return `telenow-cli/${cliVersion()} (node ${process.version}; ${process.platform})`;
}
