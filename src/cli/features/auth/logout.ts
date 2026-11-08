/**
 * logout.ts — `telenow logout`: forget a saved login on this computer; `--revoke` also kills the key.
 *
 * In here: `logoutCommand`. It removes the profile (and its key) from the config file.
 * - Without `--revoke` the key stays valid on the server, and the note says so.
 * - With `--revoke` it first calls `POST /api/v1/me/revoke` with THAT profile's key (any key role
 *   may revoke itself; CLI_BROWSER_LOGIN_PLAN.md §3.8), sent only to the server the profile was
 *   saved for — never TELENOW_API_KEY's key, never another `--base-url`. Then:
 *   - 200: revoked; the profile is forgotten;
 *   - 401: the server no longer takes the key (revoked or expired already); it is forgotten too;
 *   - 404: the server is older and cannot revoke from the CLI; the profile is KEPT, so the key
 *     can still be found and revoked in the dashboard;
 *   - anything else: the error, and the profile is kept.
 * The request goes through the client directly, not `core/write_request.ts`: that sends with the
 * resolved login, which TELENOW_API_KEY overrides, and there is nothing to dry-run.
 * Not in here: the file (`core/config_store.ts`).
 * Called by: `features/auth/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, type CommandSpec } from '../../core/command_spec.js';
import { readConfig, writeConfig } from '../../core/config_store.js';
import { checkBaseUrl, selectProfileName } from '../../core/resolve_login.js';

export const logoutCommand: CommandSpec = {
  path: ['logout'],
  summary: 'forget a saved login on this computer (--revoke also revokes its key on the server)',
  options: {
    revoke: { type: 'boolean', help: "revoke the profile's key on the server first, then forget it" },
  },
  async run(ctx) {
    const cfg = readConfig(ctx.configFile);
    const name = selectProfileName({ profile: ctx.global.profile }, ctx.env, cfg);
    const profile = cfg.profiles[name];
    if (!profile) throw new CliError(`there is no saved profile '${name}'`, EXIT.notFound);

    let revoked: { revoked: boolean; keyId: string | null } | undefined;
    if (boolOption(ctx.values, 'revoke')) {
      const savedFor = checkBaseUrl(profile.baseUrl);
      const asked = ctx.global.baseUrl ?? ctx.env.TELENOW_BASE_URL;
      if (asked !== undefined && checkBaseUrl(asked) !== savedFor) {
        throw new CliError(
          `--revoke sends the profile's key only to the server it was saved for (${savedFor}), not ${checkBaseUrl(asked)}`,
          EXIT.usage,
        );
      }
      try {
        const res = await ctx.apiFor(savedFor, profile.apiKey).send('POST', '/api/v1/me/revoke');
        const body = dataOf(res.body) as { keyId?: unknown } | null;
        revoked = { revoked: true, keyId: typeof body?.keyId === 'string' ? body.keyId : (profile.keyId ?? null) };
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        if (e.status === 404) {
          throw new CliError(
            `${savedFor} cannot revoke a key from the CLI yet (the server is older); revoke it in the dashboard. ` +
              `The profile '${name}' was kept; \`telenow logout\` without --revoke forgets it`,
            EXIT.notFound,
            { status: 404, code: 'revoke_unavailable' },
          );
        }
        if (e.status !== 401) throw e;
        revoked = { revoked: false, keyId: profile.keyId ?? null };
      }
    }

    delete cfg.profiles[name];
    if (cfg.currentProfile === name) cfg.currentProfile = Object.keys(cfg.profiles).sort()[0];
    writeConfig(ctx.configFile, cfg);
    const data = { removed: name, currentProfile: cfg.currentProfile ?? null, ...(revoked ?? {}) };
    if (!revoked) {
      return { data, notes: [{ note: 'the API key is still valid on the server; revoke it in the dashboard if it may have leaked' }] };
    }
    if (!revoked.revoked) {
      return { data, notes: [{ note: 'the server no longer accepted this key (revoked or expired already); the profile was removed' }] };
    }
    return { data };
  },
};
