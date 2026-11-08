/**
 * create_kb.ts — `telenow kb create --name <name> [--description <text>]`: a new, empty
 * knowledge base.
 *
 * In here: `createKbCommand` → `POST /api/orgs/:orgId/knowledge-bases` (`{ name, description? }`,
 * 201). Sends an Idempotency-Key; `--dry-run` shows the request.
 * Not in here: adding documents (`add_document.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, sendWrite } from '../../core/write_request.js';
import { kbPath, onKnowledgeOff } from './kb_paths.js';

export const createKbCommand: CommandSpec = {
  path: ['kb', 'create'],
  summary: 'create an empty knowledge base',
  options: {
    name: { type: 'string', value: '<name>', help: 'its name (required)' },
    description: { type: 'string', value: '<text>', help: 'what it holds' },
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const name = stringOption(ctx.values, 'name')?.trim();
    if (!name) throw new CliError('--name is required', EXIT.usage);
    const body = { name, description: stringOption(ctx.values, 'description') };
    const w = await onKnowledgeOff(sendWrite(ctx, { method: 'POST', path: await kbPath(ctx, ''), body, creates: true }));
    if (!w.sent) return { data: w.dryRun };
    return { data: dataOf(w.res.body), raw: w.res.body };
  },
};
