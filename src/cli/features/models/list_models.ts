/**
 * list_models.ts — `telenow models list [--kind <k>] [--provider <p>]`: the providers and models
 * an agent can use.
 *
 * In here: `listModelsCommand` → `GET /api/catalog`, one row per model: kind, provider, model id,
 * name, recommended.
 * - `--full` (or `--fields details.…`) adds each model's whole entry: prices, context window,
 *   abilities.
 * - `--kind` takes the kinds the server answered with (checked against that answer, not a list
 *   in the CLI); `--provider` takes a provider id.
 * - The ids go into an agent as `llmProvider` / `llmModel`, `sttProvider` (and `sttConfig`'s
 *   model), `ttsProvider` (and `ttsConfig`'s model).
 * - The platform fee and feature switches are in `--output raw`.
 * Not in here: reading the catalog (`read_catalog.ts`); a TTS provider's live voice list
 * (`telenow voices list`).
 * Called by: `features/models/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { catalogKinds, catalogRows, fetchCatalog } from './read_catalog.js';

const SHORT_VIEW = ['kind', 'provider', 'model', 'name', 'recommended'];

export const listModelsCommand: CommandSpec = {
  path: ['models', 'list'],
  summary: 'list the providers and models an agent can use',
  options: {
    kind: { type: 'string', value: '<kind>', help: 'only this kind, e.g. llm, stt, tts' },
    provider: { type: 'string', value: '<id>', help: 'only this provider' },
    full: { type: 'boolean', help: "add each model's prices, limits and abilities" },
  },
  async run(ctx) {
    const { catalog, raw } = await fetchCatalog(ctx);
    const kind = stringOption(ctx.values, 'kind');
    const kinds = catalogKinds(catalog);
    if (kind !== undefined && !kinds.includes(kind)) {
      throw new CliError(`--kind must be one of ${kinds.join(', ')} (got '${kind}')`, EXIT.usage);
    }
    const provider = stringOption(ctx.values, 'provider');
    const rows = catalogRows(catalog).filter(
      (r) => (kind === undefined || r.kind === kind) && (provider === undefined || r.provider === provider),
    );
    const notes: unknown[] = [];
    if (provider !== undefined && rows.length === 0) {
      notes.push({ note: `no provider '${provider}'${kind ? ` of kind ${kind}` : ''} in the catalog` });
    }
    return { data: rows, raw, defaultFields: boolOption(ctx.values, 'full') ? undefined : SHORT_VIEW, notes };
  },
};
