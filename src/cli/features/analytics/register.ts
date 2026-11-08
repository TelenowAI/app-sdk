/**
 * register.ts — the analytics command.
 *
 * Files in this folder:
 *   get_analytics.ts  telenow analytics   call numbers per day and per agent
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { getAnalyticsCommand } from './get_analytics.js';

export const analyticsCommands: CommandSpec[] = [getAnalyticsCommand];
