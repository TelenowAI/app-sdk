/**
 * update_agent.ts — `telenow agents update <agent-id> --file patch.json`: change an agent.
 *
 * In here: `updateAgentCommand` → `PUT /api/agents/:id` with ONLY the fields in the file
 * (camelCase). Rules:
 * - `metadata` — the server REPLACES it whole, so a patch with `{ "metadata": { "tools": […] } }`
 *   would wipe the flow, variables and every other key. By default the CLI reads the agent
 *   (version first, then the agent) and sends its current metadata with the patch's top-level
 *   keys laid over it, with `If-Match` on the version it read — so the merge never overwrites a
 *   save it did not see. `--replace-metadata` sends the patch's metadata as it is.
 * - `--expected-version <n>` sends `If-Match: "n"`; a save made since is refused (exit 4).
 * - Masked secrets read back from the server are restored by the server on save.
 * - Provider and model ids in the file are checked against the platform's catalog first, with the
 *   agent's saved provider when the file changes only the model, or the other way round
 *   (`check_models.ts`; `--skip-catalog-check`).
 * - `--dry-run` shows the request; nothing is sent.
 * Not in here: the prompt / flow workflow with local files (`features/prompts/`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, intOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { FILE_OPTION, readJsonObject } from '../../core/read_json_file.js';
import { DRY_RUN_OPTION, sendWrite } from '../../core/write_request.js';
import { fetchAgentAtVersion, metadataOf } from '../prompts/agent_state.js';
import { checkModels, SKIP_CATALOG_OPTION } from './check_models.js';
import { snakeCaseNotes } from './request_keys.js';

export const updateAgentCommand: CommandSpec = {
  path: ['agents', 'update'],
  summary: 'change an agent from a JSON file of the fields to change (camelCase)',
  args: ['agent-id'],
  options: {
    file: FILE_OPTION,
    'expected-version': { type: 'string', value: '<n>', help: 'refuse if the agent is no longer at this version' },
    'replace-metadata': { type: 'boolean', help: "send the file's metadata as the WHOLE metadata (default: merge its keys)" },
    'skip-catalog-check': SKIP_CATALOG_OPTION,
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const id = ctx.args['agent-id'];
    const patch = await readJsonObject(ctx, stringOption(ctx.values, 'file'), 'the fields to change');
    const notes = snakeCaseNotes(patch);
    await checkModels(ctx, patch, async () => {
      const a = dataOf((await ctx.api().get(`/api/agents/${encodeURIComponent(id)}`)).body);
      return a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
    });
    let expected = intOption(ctx.values, 'expected-version', 0);
    const body: Record<string, unknown> = { ...patch };
    const mergeMeta = patch.metadata !== undefined && !boolOption(ctx.values, 'replace-metadata');
    if (mergeMeta) {
      if (!patch.metadata || typeof patch.metadata !== 'object' || Array.isArray(patch.metadata)) {
        throw new CliError('metadata in the file must be a JSON object', EXIT.usage);
      }
      const { agent, version } = await fetchAgentAtVersion(ctx, id);
      if (expected !== undefined && expected !== version) {
        throw new CliError(`agent ${id} is at version ${version}, not ${expected}; nothing was saved`, EXIT.conflict, {
          status: 409,
          code: 'agent_version_conflict',
          details: { currentVersion: version },
        });
      }
      expected = version;
      body.metadata = { ...metadataOf(agent), ...(patch.metadata as Record<string, unknown>) };
    }
    const headers: Record<string, string> = expected !== undefined ? { 'If-Match': `"${expected}"` } : {};
    const w = await sendWrite(ctx, { method: 'PUT', path: `/api/agents/${encodeURIComponent(id)}`, body, headers });
    if (!w.sent) return { data: w.dryRun, notes };
    const saved = w.res.body as { version?: unknown } | null;
    return {
      data: { version: typeof saved?.version === 'number' ? saved.version : null, agent: dataOf(w.res.body) },
      raw: w.res.body,
      notes,
    };
  },
};
