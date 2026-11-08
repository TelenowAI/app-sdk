/**
 * pull_prompt.ts — `telenow prompts pull <agent-id>`: the agent's LIVE prompt (and flow) to
 * local files.
 *
 * In here: `pullPromptCommand`. It reads the version, then the agent (`agent_state.ts` says
 * why in that order), and writes the files `prompt_files.ts` lays out. It refuses to overwrite
 * local edits that were never pushed unless `--force`. When the dashboard holds an unpublished
 * draft, it pulls the live copy and says so on stderr.
 * Not in here: comparing (`diff_prompt.ts`), saving back (`push_prompt.ts`).
 * Called by: `features/prompts/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRAFT_NOTE, fetchAgentAtVersion, hasDashboardDraft, isFlowAgent, metadataOf } from './agent_state.js';
import { agentFolder, DIR_OPTION, rootFolder, unpushedEdits, writePulled, type PulledMeta } from './prompt_files.js';

export const pullPromptCommand: CommandSpec = {
  path: ['prompts', 'pull'],
  summary: "save an agent's live prompt (and flow) to local files",
  args: ['agent-id'],
  options: {
    dir: DIR_OPTION,
    force: { type: 'boolean', help: 'overwrite local edits that were never pushed' },
  },
  async run(ctx) {
    const id = ctx.args['agent-id'];
    const root = rootFolder(ctx.cwd, stringOption(ctx.values, 'dir'));
    agentFolder(root, id); // refuses a bad id before anything is fetched
    const edited = unpushedEdits(root, id);
    if (edited.length > 0 && !boolOption(ctx.values, 'force')) {
      throw new CliError(
        `${edited.join(' and ')} in ${agentFolder(root, id)} changed since the last pull or push. ` +
          'Push them with `telenow prompts push`, or pull with --force to throw them away.',
        EXIT.usage,
        { details: { edited } },
      );
    }
    const { agent, version } = await fetchAgentAtVersion(ctx, id);
    const flow = isFlowAgent(agent) ? metadataOf(agent).flow : undefined;
    const meta: PulledMeta = {
      agentId: id,
      name: typeof agent.name === 'string' ? agent.name : null,
      baseUrl: ctx.api().baseUrl,
      version,
      isFlow: flow !== undefined,
      pulledAt: new Date().toISOString(),
    };
    const files = writePulled(root, meta, typeof agent.system_prompt === 'string' ? agent.system_prompt : '', flow);
    const draft = hasDashboardDraft(agent);
    return {
      data: { agentId: id, name: meta.name, version, isFlow: meta.isFlow, hasDashboardDraft: draft, files },
      notes: draft ? [{ warning: DRAFT_NOTE }] : [],
    };
  },
};
