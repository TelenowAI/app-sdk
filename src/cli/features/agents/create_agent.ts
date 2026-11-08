/**
 * create_agent.ts — `telenow agents create --file agent.json`: create an agent.
 *
 * In here: `createAgentCommand` → `POST /api/agents` with the file's object as the body
 * (camelCase fields, as in the Agents API docs; a flow agent carries `metadata.flow`). It sends
 * an Idempotency-Key (`--idempotency-key` to retry safely) and supports `--dry-run`. Creating
 * an agent does not dial or spend, so it does not ask first. Provider and model ids are checked
 * against the platform's catalog first (`check_models.ts`; `--skip-catalog-check`).
 * Not in here: changing an agent (`update_agent.ts`), the snake_case check (`request_keys.ts`).
 * Called by: `features/agents/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { FILE_OPTION, readJsonObject } from '../../core/read_json_file.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, sendWrite } from '../../core/write_request.js';
import { checkModels, SKIP_CATALOG_OPTION } from './check_models.js';
import { snakeCaseNotes } from './request_keys.js';

export const createAgentCommand: CommandSpec = {
  path: ['agents', 'create'],
  summary: 'create an agent from a JSON file (camelCase fields)',
  options: {
    file: FILE_OPTION,
    'skip-catalog-check': SKIP_CATALOG_OPTION,
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const body = await readJsonObject(ctx, stringOption(ctx.values, 'file'), 'the agent');
    const notes = snakeCaseNotes(body);
    await checkModels(ctx, body);
    const w = await sendWrite(ctx, { method: 'POST', path: '/api/agents', body, creates: true });
    if (!w.sent) return { data: w.dryRun, notes };
    return { data: dataOf(w.res.body), raw: w.res.body, notes };
  },
};
