/**
 * register.ts — the agent commands, in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   list_agents.ts    telenow agents list       the org's agents (short view, pages)
 *   get_agent.ts      telenow agents get        one agent, secrets masked
 *   create_agent.ts   telenow agents create     from a JSON file
 *   update_agent.ts   telenow agents update     the fields in a JSON file; metadata merged
 *   delete_agent.ts   telenow agents delete     asks first, or --yes
 *   list_versions.ts  telenow agents versions   saved versions, newest first
 *   diff_version.ts   telenow agents diff       what one version changed
 *   restore_version.ts telenow agents restore   an old version live again (as a new version)
 *   agent_stats.ts    telenow agents stats      call totals and latencies
 *   request_keys.ts   the camelCase-request check create and update share
 *   check_models.ts   the catalog check of provider and model ids create and update share
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { agentStatsCommand } from './agent_stats.js';
import { createAgentCommand } from './create_agent.js';
import { deleteAgentCommand } from './delete_agent.js';
import { diffVersionCommand } from './diff_version.js';
import { getAgentCommand } from './get_agent.js';
import { listAgentsCommand } from './list_agents.js';
import { listVersionsCommand } from './list_versions.js';
import { restoreVersionCommand } from './restore_version.js';
import { updateAgentCommand } from './update_agent.js';

export const agentCommands: CommandSpec[] = [
  listAgentsCommand,
  getAgentCommand,
  createAgentCommand,
  updateAgentCommand,
  deleteAgentCommand,
  listVersionsCommand,
  diffVersionCommand,
  restoreVersionCommand,
  agentStatsCommand,
];
