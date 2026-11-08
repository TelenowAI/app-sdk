/**
 * push_prompt.ts — `telenow prompts push <agent-id>`: save the local prompt (and flow) as the
 * agent's LIVE prompt, only if nobody changed the agent since the pull.
 *
 * In here: `pushPromptCommand`. Steps, in order:
 *   1. the files must come from this server, and must say which version they were pulled at;
 *   2. read the server's version and agent; a version that moved is refused here already
 *      (`--force` skips this and the precondition in 6);
 *   3. nothing changed → say so and stop;
 *   4. an unpublished dashboard draft → refused (`--ignore-draft` overrides): the dashboard
 *      opens the draft first, and its next Publish would write the draft over this push;
 *   5. check the changed prompt (`POST /api/agents/prompt/validate`) and flow
 *      (`POST /api/agents/flow/validate`); errors stop the push, warnings go to stderr;
 *   6. `PUT /api/agents/:id` with `If-Match: "<pulled version>"` and ONLY what changed:
 *      `systemPrompt`, and for a flow the WHOLE `metadata` just read with `flow` replaced
 *      (the server replaces `metadata` whole, so a partial one would wipe the other keys;
 *      masked secrets in it are restored by the server);
 *   7. record the new version and file hashes, so the next push builds on this one.
 * `--dry-run` stops after 5 and prints the request it would send (the key never appears).
 * Not in here: the comparison rules (`local_changes.ts`), the files (`prompt_files.ts`).
 * Called by: `features/prompts/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandContext, type CommandSpec } from '../../core/command_spec.js';
import { fetchAgentAtVersion, hasDashboardDraft, metadataOf, toolNames, type AgentRow } from './agent_state.js';
import { compareWithServer, promptText } from './local_changes.js';
import { checkSameServer, DIR_OPTION, fileHashes, readPulled, rootFolder, saveMeta, type PulledFiles } from './prompt_files.js';

function staleError(id: string, pulled: number | null, current: number): CliError {
  return new CliError(
    `agent ${id} changed on the server since you pulled it (you have version ${pulled}, the server has ${current}). ` +
      'Run `telenow prompts diff` to see the difference, `telenow prompts pull --force` to start again from the ' +
      "server's copy, or push with --force to overwrite it.",
    EXIT.conflict,
    { status: 409, code: 'agent_version_conflict', details: { pulledVersion: pulled, currentVersion: current } },
  );
}

interface Check {
  errors: unknown[];
  warnings: unknown[];
}

async function check(ctx: CommandContext, path: string, body: unknown): Promise<Check> {
  const d = dataOf((await ctx.api().send('POST', path, { body })).body) as { errors?: unknown; warnings?: unknown } | null;
  return {
    errors: Array.isArray(d?.errors) ? d.errors : [],
    warnings: Array.isArray(d?.warnings) ? d.warnings : [],
  };
}

/**
 * One finding, tagged with the file it is about. The prompt check answers objects
 * (`{field, code, line, column, message}`); the flow check answers its errors as plain strings
 * (`"edge 'x' target 'y' is not a node"`) and its warnings as objects — so a string becomes
 * `{ message }` rather than being spread character by character.
 */
function finding(on: string, f: unknown): Record<string, unknown> {
  return f && typeof f === 'object' && !Array.isArray(f) ? { on, ...(f as Record<string, unknown>) } : { on, message: String(f) };
}

async function validate(ctx: CommandContext, local: PulledFiles, agent: AgentRow, prompt: boolean, flow: boolean): Promise<Check> {
  const variables = Array.isArray(metadataOf(agent).variables) ? metadataOf(agent).variables : undefined;
  const out: Check = { errors: [], warnings: [] };
  if (prompt) {
    const r = await check(ctx, '/api/agents/prompt/validate', {
      prompt: promptText(local.prompt).trim(),
      kind: local.meta.isFlow ? 'flowBase' : 'single',
      variables,
      tools: toolNames(agent),
    });
    out.errors.push(...r.errors.map((e) => finding('prompt.md', e)));
    out.warnings.push(...r.warnings.map((w) => finding('prompt.md', w)));
  }
  if (flow) {
    const r = await check(ctx, '/api/agents/flow/validate', { flow: local.flow, variables });
    out.errors.push(...r.errors.map((e) => finding('flow.json', e)));
    out.warnings.push(...r.warnings.map((w) => finding('flow.json', w)));
  }
  return out;
}

export const pushPromptCommand: CommandSpec = {
  path: ['prompts', 'push'],
  summary: "save the local prompt (and flow) as the agent's live prompt",
  args: ['agent-id'],
  options: {
    dir: DIR_OPTION,
    'dry-run': { type: 'boolean', help: 'check and show the request, save nothing' },
    force: { type: 'boolean', help: 'save even if the agent changed on the server since the pull' },
    'ignore-draft': {
      type: 'boolean',
      help: 'save even though the dashboard holds an unpublished draft (its next Publish overwrites this)',
    },
  },
  async run(ctx) {
    const id = ctx.args['agent-id'];
    const force = boolOption(ctx.values, 'force');
    const local = readPulled(rootFolder(ctx.cwd, stringOption(ctx.values, 'dir')), id);
    checkSameServer(local.meta.baseUrl, ctx.api().baseUrl);
    if (!force && typeof local.meta.version !== 'number') {
      throw new CliError('the files do not say which version they were pulled at; pull the agent again', EXIT.usage);
    }

    const { agent, version } = await fetchAgentAtVersion(ctx, id);
    if (!force && version !== local.meta.version) throw staleError(id, local.meta.version, version);

    const c = compareWithServer(local, agent);
    const changed = [...(c.promptChanged ? ['prompt'] : []), ...(c.flowChanged ? ['flow'] : [])];
    if (changed.length === 0) return { data: { agentId: id, changed: [], saved: false, version } };

    if (hasDashboardDraft(agent) && !boolOption(ctx.values, 'ignore-draft')) {
      throw new CliError(
        `agent ${id} has unpublished changes saved in the dashboard (a draft). The dashboard opens the draft ` +
          'first, so its next Publish would overwrite this push. Publish or discard the draft in the dashboard, ' +
          'then pull again — or push with --ignore-draft.',
        EXIT.conflict,
        { code: 'dashboard_draft' },
      );
    }

    const checked = await validate(ctx, local, agent, c.promptChanged, c.flowChanged);
    const notes = checked.warnings.map((w) => ({ warning: w }));
    if (checked.errors.length > 0) {
      throw new CliError('the server found errors in the local files; nothing was saved', EXIT.usage, {
        code: 'invalid_prompt',
        details: { errors: checked.errors, warnings: checked.warnings },
      });
    }

    const body: Record<string, unknown> = {};
    if (c.promptChanged) body.systemPrompt = c.localPrompt.trim();
    if (c.flowChanged) body.metadata = { ...metadataOf(agent), flow: local.flow };
    const headers: Record<string, string> = force ? {} : { 'If-Match': `"${local.meta.version}"` };
    const path = `/api/agents/${encodeURIComponent(id)}`;

    if (boolOption(ctx.values, 'dry-run')) {
      return {
        data: { agentId: id, dryRun: true, changed, request: { method: 'PUT', path, headers, body } },
        notes,
      };
    }

    let res;
    try {
      res = await ctx.api().send('PUT', path, { body, headers });
    } catch (e) {
      if (e instanceof CliError && e.status === 409 && e.code === 'agent_version_conflict') {
        const current = typeof e.details?.currentVersion === 'number' ? e.details.currentVersion : version;
        throw staleError(id, local.meta.version, current);
      }
      throw e;
    }
    const saved = res.body as { version?: unknown } | null;
    const newVersion = typeof saved?.version === 'number' ? saved.version : null;
    saveMeta(local.folder, {
      ...local.meta,
      version: newVersion,
      pushedAt: new Date().toISOString(),
      sha256: fileHashes(local.folder),
    });
    return {
      data: { agentId: id, changed, saved: true, version: newVersion },
      notes:
        newVersion === null
          ? [...notes, { warning: 'the server did not return the new version; pull again before the next push' }]
          : notes,
    };
  },
};
