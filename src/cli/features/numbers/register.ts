/**
 * register.ts — the phone-number commands, in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   list_numbers.ts         telenow numbers list              the org's numbers
 *   get_number.ts           telenow numbers get               one number, with its price
 *   search_numbers.ts       telenow numbers search            numbers for sale now (free)
 *   list_providers.ts       telenow numbers providers         the carriers open to the org
 *   number_requirements.ts  telenow numbers requirements      documents a regulated country needs
 *   assign_number.ts        telenow numbers assign            an agent answers it (asks if it moves anything)
 *   unassign_number.ts      telenow numbers unassign          the agent stops answering it (asks)
 *   default_outbound.ts     telenow numbers default-outbound  its agent's outbound caller id, or not
 *   inbound_action.ts       telenow numbers inbound-action    what it does with a call when no agent has it
 *   buy_number.ts           telenow numbers buy               rent one (spends money; asks)
 *   release_number.ts       telenow numbers release           give one up (cannot be undone; asks)
 *   renewal_risk.ts         telenow numbers renewal-risk      renewals ahead and the balance for them
 *   reclaimable_numbers.ts  telenow numbers reclaimable       lost numbers that can be bought back
 *   reclaim_number.ts       telenow numbers reclaim           buy one back (spends money; asks)
 *   number_row.ts           reading one number and an agent's name, shared
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { assignNumberCommand } from './assign_number.js';
import { buyNumberCommand } from './buy_number.js';
import { defaultOutboundCommand } from './default_outbound.js';
import { getNumberCommand } from './get_number.js';
import { inboundActionCommand } from './inbound_action.js';
import { listNumbersCommand } from './list_numbers.js';
import { providersCommand } from './list_providers.js';
import { requirementsCommand } from './number_requirements.js';
import { reclaimNumberCommand } from './reclaim_number.js';
import { reclaimableCommand } from './reclaimable_numbers.js';
import { releaseNumberCommand } from './release_number.js';
import { renewalRiskCommand } from './renewal_risk.js';
import { searchNumbersCommand } from './search_numbers.js';
import { unassignNumberCommand } from './unassign_number.js';

export const numberCommands: CommandSpec[] = [
  listNumbersCommand,
  getNumberCommand,
  searchNumbersCommand,
  providersCommand,
  requirementsCommand,
  assignNumberCommand,
  unassignNumberCommand,
  defaultOutboundCommand,
  inboundActionCommand,
  buyNumberCommand,
  releaseNumberCommand,
  renewalRiskCommand,
  reclaimableCommand,
  reclaimNumberCommand,
];
