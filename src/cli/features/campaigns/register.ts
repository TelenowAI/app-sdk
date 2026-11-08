/**
 * register.ts — the campaign commands, in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   list_campaigns.ts       telenow campaigns list          the org's campaigns
 *   get_campaign.ts         telenow campaigns get           one, and why it is not dialling
 *   create_campaign.ts      telenow campaigns create        a draft (nothing dials)
 *   add_targets.ts          telenow campaigns add-targets   people from .csv / .json (asks if they'd be called now)
 *   start_campaign.ts       telenow campaigns start         dial (asks first, or --yes)
 *   pause_campaign.ts       telenow campaigns pause         stop for now
 *   cancel_campaign.ts      telenow campaigns cancel        stop for good (asks first, or --yes)
 *   list_campaign_calls.ts  telenow campaigns calls         each person and where they are
 *   campaign_results.ts     telenow campaigns results       outcome per finished person
 *   campaign_analytics.ts   telenow campaigns analytics     totals
 *   campaign_paths.ts       paths, the campaign row, the short view
 *   change_status.ts        start / pause / cancel, with the status read back
 *   target_file.ts          reading and checking a file of people
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { addTargetsCommand } from './add_targets.js';
import { campaignAnalyticsCommand } from './campaign_analytics.js';
import { campaignResultsCommand } from './campaign_results.js';
import { cancelCampaignCommand } from './cancel_campaign.js';
import { createCampaignCommand } from './create_campaign.js';
import { getCampaignCommand } from './get_campaign.js';
import { listCampaignCallsCommand } from './list_campaign_calls.js';
import { listCampaignsCommand } from './list_campaigns.js';
import { pauseCampaignCommand } from './pause_campaign.js';
import { startCampaignCommand } from './start_campaign.js';

export const campaignCommands: CommandSpec[] = [
  listCampaignsCommand,
  getCampaignCommand,
  createCampaignCommand,
  addTargetsCommand,
  startCampaignCommand,
  pauseCampaignCommand,
  cancelCampaignCommand,
  listCampaignCallsCommand,
  campaignResultsCommand,
  campaignAnalyticsCommand,
];
