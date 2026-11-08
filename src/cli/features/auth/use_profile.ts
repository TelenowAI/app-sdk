/**
 * use_profile.ts — `telenow profiles use <name>`: make a saved login the current one.
 *
 * In here: `useProfileCommand`. The profile must already be saved (`telenow login --profile`).
 * Not in here: listing (`list_profiles.ts`), the file (`core/config_store.ts`).
 * Called by: `features/auth/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandSpec } from '../../core/command_spec.js';
import { checkProfileName, readConfig, writeConfig } from '../../core/config_store.js';

export const useProfileCommand: CommandSpec = {
  path: ['profiles', 'use'],
  summary: 'make a saved login the current one',
  args: ['name'],
  async run(ctx) {
    const name = checkProfileName(ctx.args.name);
    const cfg = readConfig(ctx.configFile);
    if (!cfg.profiles[name]) {
      throw new CliError(`there is no saved profile '${name}'; save one with \`telenow login --profile ${name}\``, EXIT.notFound);
    }
    cfg.currentProfile = name;
    writeConfig(ctx.configFile, cfg);
    return { data: { currentProfile: name, baseUrl: cfg.profiles[name].baseUrl, orgName: cfg.profiles[name].orgName ?? null } };
  },
};
