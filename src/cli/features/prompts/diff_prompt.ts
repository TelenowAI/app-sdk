/**
 * diff_prompt.ts — `telenow prompts diff <agent-id>`: local files vs the agent on the server.
 *
 * In here: `diffPromptCommand`. `--format text` (default) prints a unified diff (server → local)
 * of the prompt and, for a flow agent, of the flow, headed by a line when the server moved
 * past the pulled version or holds an unpublished dashboard draft. `--format json` prints the
 * same as fields. A diff with changes still exits 0, as `git diff` does.
 * Not in here: the comparison rules (`local_changes.ts`), saving (`push_prompt.ts`).
 * Called by: `features/prompts/register.ts`.
 */

import { oneOf, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { unifiedDiff } from '../../core/line_diff.js';
import { fetchAgentAtVersion, hasDashboardDraft } from './agent_state.js';
import { compareWithServer } from './local_changes.js';
import { checkSameServer, DIR_OPTION, readPulled, rootFolder } from './prompt_files.js';

export const diffPromptCommand: CommandSpec = {
  path: ['prompts', 'diff'],
  summary: 'show what the local files change on the server',
  args: ['agent-id'],
  options: {
    dir: DIR_OPTION,
    format: { type: 'string', value: '<text|json>', help: 'text (default): a unified diff; json: fields' },
  },
  async run(ctx) {
    const id = ctx.args['agent-id'];
    const format = oneOf(ctx.values, 'format', ['text', 'json'] as const) ?? 'text';
    const local = readPulled(rootFolder(ctx.cwd, stringOption(ctx.values, 'dir')), id);
    checkSameServer(local.meta.baseUrl, ctx.api().baseUrl);
    const { agent, version } = await fetchAgentAtVersion(ctx, id);
    const c = compareWithServer(local, agent);
    const promptDiff = unifiedDiff(c.serverPrompt, c.localPrompt, {
      old: `server: prompt (version ${version})`,
      new: 'local: prompt.md',
    });
    const flowDiff =
      c.localFlow === null && c.serverFlow === null
        ? ''
        : unifiedDiff(c.serverFlow ?? '', c.localFlow ?? '', { old: `server: flow (version ${version})`, new: 'local: flow.json' });
    const moved = local.meta.version !== version;
    const draft = hasDashboardDraft(agent);
    if (format === 'json') {
      return {
        data: {
          agentId: id,
          pulledVersion: local.meta.version,
          serverVersion: version,
          serverChangedSincePull: moved,
          hasDashboardDraft: draft,
          changed: c.promptChanged || c.flowChanged,
          prompt: { changed: c.promptChanged, diff: promptDiff },
          flow: c.localFlow === null ? null : { changed: c.flowChanged, diff: flowDiff },
        },
      };
    }
    const head: string[] = [];
    if (moved) {
      head.push(`# the server is at version ${version}; you pulled version ${local.meta.version}. Pull again before pushing.`);
    }
    if (draft) head.push('# the dashboard holds an unpublished draft of this agent; `prompts push` refuses until it is published or discarded.');
    const body = c.promptChanged || c.flowChanged ? promptDiff + flowDiff : 'no changes\n';
    return { text: [...head, body].join('\n') };
  },
};
