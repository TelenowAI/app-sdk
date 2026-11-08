/**
 * whoami.ts — `telenow whoami`: which org, key and role this computer is acting as.
 *
 * In here: `whoamiCommand` — `GET /api/v1/me` with the resolved login, plus where the key came
 * from (`profile` or the `TELENOW_API_KEY` env variable) and the server it talks to. The key
 * itself is never printed.
 * Not in here: how the login is chosen (`core/resolve_login.ts`).
 * Called by: `features/auth/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandSpec } from '../../core/command_spec.js';

export const whoamiCommand: CommandSpec = {
  path: ['whoami'],
  summary: 'show the org, key name and key role in use',
  async run(ctx) {
    const login = ctx.login();
    const res = await ctx.api().get('/api/v1/me');
    const me = dataOf(res.body);
    return {
      data: {
        profile: login.keySource === 'profile' ? login.profileName : null,
        keySource: login.keySource,
        baseUrl: login.baseUrl,
        ...(me && typeof me === 'object' ? (me as Record<string, unknown>) : {}),
      },
      raw: res.body,
    };
  },
};
