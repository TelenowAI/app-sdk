/**
 * list_profiles.ts — `telenow profiles list`: the logins saved on this computer.
 *
 * In here: `listProfilesCommand`. One row per profile — name, whether it is current, server,
 * org, key name and role — and never the key.
 * Not in here: switching (`use_profile.ts`), the file (`core/config_store.ts`).
 * Called by: `features/auth/register.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { readConfig } from '../../core/config_store.js';

export const listProfilesCommand: CommandSpec = {
  path: ['profiles', 'list'],
  summary: 'list the logins saved on this computer',
  async run(ctx) {
    const cfg = readConfig(ctx.configFile);
    const rows = Object.keys(cfg.profiles)
      .sort()
      .map((name) => {
        const p = cfg.profiles[name];
        return {
          name,
          current: cfg.currentProfile === name,
          baseUrl: p.baseUrl,
          orgId: p.orgId ?? null,
          orgName: p.orgName ?? null,
          keyName: p.keyName ?? null,
          keyRole: p.keyRole ?? null,
          savedAt: p.savedAt ?? null,
        };
      });
    return { data: rows };
  },
};
