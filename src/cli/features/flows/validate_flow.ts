/**
 * validate_flow.ts — `telenow flows validate --file flow.json`: check a flow graph with the
 * server, exactly as calls will, without saving anything.
 *
 * In here: `validateFlowCommand` → `POST /api/agents/flow/validate` (`{ flow, variables? }`).
 * The file holds the graph (`{ schema, startNodeId, nodes, edges }`) — or a whole agent body,
 * whose `metadata.flow` and `metadata.variables` are used. A valid graph prints
 * `{ valid, warnings, multiContext }`; an invalid one exits 1 with the server's errors (plain
 * strings, as it sends them) and warnings (objects) on stderr.
 * Not in here: pushing a flow (`features/prompts/push_prompt.ts`).
 * Called by: `features/flows/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { FILE_OPTION, readJsonObject } from '../../core/read_json_file.js';

export const validateFlowCommand: CommandSpec = {
  path: ['flows', 'validate'],
  summary: 'check a flow graph with the server, as calls will (saves nothing)',
  options: { file: FILE_OPTION },
  async run(ctx) {
    const obj = await readJsonObject(ctx, stringOption(ctx.values, 'file'), 'a flow graph');
    const meta = obj.metadata && typeof obj.metadata === 'object' ? (obj.metadata as Record<string, unknown>) : undefined;
    const flow = meta?.flow ?? obj;
    const variables = Array.isArray(meta?.variables) ? meta.variables : undefined;
    const res = await ctx.api().send('POST', '/api/agents/flow/validate', { body: { flow, variables } });
    const d = dataOf(res.body) as { valid?: unknown; errors?: unknown; warnings?: unknown; multiContext?: unknown } | null;
    const errors = Array.isArray(d?.errors) ? d.errors : [];
    const warnings = Array.isArray(d?.warnings) ? d.warnings : [];
    if (errors.length > 0) {
      throw new CliError('the flow has errors; a call would run without it', EXIT.usage, {
        code: 'invalid_flow',
        details: { errors, warnings },
      });
    }
    return { data: { valid: true, warnings, multiContext: d?.multiContext ?? null }, raw: res.body };
  },
};
