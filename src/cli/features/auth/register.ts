/**
 * register.ts — the auth commands, in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   login.ts          telenow login            sign in with the browser, or save a checked API key
 *   browser_login.ts  (used by login.ts)       the device-code sign-in: start, show, open, poll
 *   logout.ts         telenow logout           forget a saved login; --revoke kills its key
 *   whoami.ts         telenow whoami           org, key and role in use
 *   list_profiles.ts  telenow profiles list    saved logins
 *   use_profile.ts    telenow profiles use     switch the current login
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { listProfilesCommand } from './list_profiles.js';
import { loginCommand } from './login.js';
import { logoutCommand } from './logout.js';
import { useProfileCommand } from './use_profile.js';
import { whoamiCommand } from './whoami.js';

export const authCommands: CommandSpec[] = [
  loginCommand,
  logoutCommand,
  whoamiCommand,
  listProfilesCommand,
  useProfileCommand,
];
