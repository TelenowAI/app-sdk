/**
 * register.ts — the sub-account commands (`/api/v1/sub-accounts`), in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   list_sub_accounts.ts        telenow sub-accounts list        the org's sub-accounts, this month's spend
 *   get_sub_account.ts          telenow sub-accounts get         one, with its limits and use
 *   sub_account_usage.ts        telenow sub-accounts usage       calls and spend over a window
 *   create_sub_account.ts       telenow sub-accounts create      a new one and its first key (a limit required)
 *   update_sub_account.ts       telenow sub-accounts update      its name, your id for it, its limits
 *   suspend_sub_account.ts      telenow sub-accounts suspend     stop it calling (asks: ends live calls)
 *   resume_sub_account.ts       telenow sub-accounts resume      let it call again
 *   rotate_sub_account_key.ts   telenow sub-accounts rotate-key  a new key (asks: the old ones stop working)
 *   close_sub_account.ts        telenow sub-accounts close       close it for good (asks)
 *   sub_account_paths.ts        the route, the id check and the limit options, shared
 *   save_new_key.ts             where a new key's secret goes (a profile, a new file, or the screen)
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { closeSubAccountCommand } from './close_sub_account.js';
import { createSubAccountCommand } from './create_sub_account.js';
import { getSubAccountCommand } from './get_sub_account.js';
import { listSubAccountsCommand } from './list_sub_accounts.js';
import { resumeSubAccountCommand } from './resume_sub_account.js';
import { rotateSubAccountKeyCommand } from './rotate_sub_account_key.js';
import { subAccountUsageCommand } from './sub_account_usage.js';
import { suspendSubAccountCommand } from './suspend_sub_account.js';
import { updateSubAccountCommand } from './update_sub_account.js';

export const subAccountCommands: CommandSpec[] = [
  listSubAccountsCommand,
  getSubAccountCommand,
  subAccountUsageCommand,
  createSubAccountCommand,
  updateSubAccountCommand,
  suspendSubAccountCommand,
  resumeSubAccountCommand,
  rotateSubAccountKeyCommand,
  closeSubAccountCommand,
];
