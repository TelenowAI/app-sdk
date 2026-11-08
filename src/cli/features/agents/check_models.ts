/**
 * check_models.ts — refuse an agent save whose provider or model ids the platform does not offer.
 *
 * In here: `SKIP_CATALOG_OPTION` and `checkModels`. The server checks only `s2sConfig` against its
 * catalog when an agent is saved. A misspelt `llmModel`, `sttProvider` or `ttsProvider` is saved
 * as it is, and fails only when a call runs. So before `agents create` / `update` send, the CLI
 * reads `GET /api/catalog` and checks every one of these fields the body sets:
 * - `llmProvider`, `sttProvider`, `ttsProvider`: a provider of that kind;
 * - `llmModel`: a model of the language-model provider. For an update that changes only one of
 *   the pair, the agent's saved value is the other half;
 * - `sttConfig` / `ttsConfig`: the value under each model setting the provider's models name
 *   (`configKey`, e.g. `model`) is one of those models.
 * `telephonyProvider` is not checked: the catalog lists only the carriers it prices, and an
 * agent may name another one the org has connected. A provider that lists no models is not
 * checked for a model. A miss stops the save (exit 1,
 * code `not_in_catalog`) and names the closest ids. `--skip-catalog-check` sends anyway, for a
 * model the catalog leaves out on purpose (switched off, or behind a server setting).
 * Not in here: reading the catalog (`features/models/read_catalog.ts`).
 * Called by: `create_agent.ts`, `update_agent.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, type CommandContext, type OptionSpec } from '../../core/command_spec.js';
import {
  catalogProviders,
  fetchCatalog,
  modelId,
  providerModels,
  type Catalog,
  type CatalogEntry,
} from '../models/read_catalog.js';

export const SKIP_CATALOG_OPTION: OptionSpec = {
  type: 'boolean',
  help: "send provider and model ids even if the platform's catalog does not list them",
};

/** The agent fields that name a provider, and the catalog kind each is checked against. */
const PROVIDER_FIELDS: Array<{ field: string; saved: string; kind: string }> = [
  { field: 'llmProvider', saved: 'llm_provider', kind: 'llm' },
  { field: 'sttProvider', saved: 'stt_provider', kind: 'stt' },
  { field: 'ttsProvider', saved: 'tts_provider', kind: 'tts' },
];

/** The config objects whose model setting is checked against the provider's models. */
const CONFIG_FIELDS: Array<{ field: string; providerField: string; saved: string; kind: string }> = [
  { field: 'sttConfig', providerField: 'sttProvider', saved: 'stt_provider', kind: 'stt' },
  { field: 'ttsConfig', providerField: 'ttsProvider', saved: 'tts_provider', kind: 'tts' },
];

/** How many near ids a refusal names: enough to spot a typo, few enough to read. */
const SUGGESTIONS = 3;

/**
 * Checks `body` (camelCase, as sent). `saved` reads the agent as stored (snake_case), for an update
 * that changes one half of a provider/model pair; it is called at most once, only when needed.
 */
export async function checkModels(
  ctx: CommandContext,
  body: Record<string, unknown>,
  saved?: () => Promise<Record<string, unknown>>,
): Promise<void> {
  if (boolOption(ctx.values, 'skip-catalog-check')) return;
  const touches =
    PROVIDER_FIELDS.some((f) => body[f.field] !== undefined) ||
    body.llmModel !== undefined ||
    CONFIG_FIELDS.some((f) => body[f.field] !== undefined);
  if (!touches) return;
  const { catalog } = await fetchCatalog(ctx);
  let stored: Record<string, unknown> | undefined;
  const storedValue = async (key: string): Promise<unknown> => {
    if (!saved) return undefined;
    stored ??= await saved();
    return stored[key];
  };

  for (const f of PROVIDER_FIELDS) {
    const v = body[f.field];
    if (v === undefined || v === null) continue;
    requireProvider(catalog, f.kind, f.field, v);
  }

  if (body.llmModel !== undefined || body.llmProvider !== undefined) {
    const providerId = body.llmProvider ?? (await storedValue('llm_provider'));
    const model = body.llmModel ?? (await storedValue('llm_model'));
    const provider = findProvider(catalog, 'llm', providerId);
    if (provider && typeof model === 'string') {
      const ids = providerModels(provider).map(modelId).filter((x): x is string => x !== null);
      if (ids.length > 0 && !ids.includes(model)) {
        refuse('llmModel', model, `the models of llm provider '${String(providerId)}'`, ids);
      }
    }
  }

  for (const f of CONFIG_FIELDS) {
    const cfg = body[f.field];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
    const providerId = body[f.providerField] ?? (await storedValue(f.saved));
    const provider = findProvider(catalog, f.kind, providerId);
    if (!provider) continue;
    const byConfigKey = new Map<string, string[]>();
    for (const m of providerModels(provider)) {
      const id = modelId(m);
      if (typeof m.configKey !== 'string' || id === null) continue;
      byConfigKey.set(m.configKey, [...(byConfigKey.get(m.configKey) ?? []), id]);
    }
    for (const [configKey, ids] of byConfigKey) {
      const v = (cfg as Record<string, unknown>)[configKey];
      if (typeof v === 'string' && !ids.includes(v)) {
        refuse(`${f.field}.${configKey}`, v, `the ${f.kind} models of '${String(providerId)}'`, ids);
      }
    }
  }
}

function findProvider(catalog: Catalog, kind: string, id: unknown): CatalogEntry | undefined {
  return typeof id === 'string' ? catalogProviders(catalog, kind).find((p) => p.id === id) : undefined;
}

function requireProvider(catalog: Catalog, kind: string, field: string, value: unknown): void {
  const ids = catalogProviders(catalog, kind).map((p) => p.id as string);
  if (typeof value !== 'string' || !ids.includes(value)) {
    refuse(field, String(value), `the ${kind} providers`, ids);
  }
}

function refuse(field: string, value: string, where: string, ids: string[]): never {
  const closest = [...ids].sort((a, b) => distance(value, a) - distance(value, b)).slice(0, SUGGESTIONS);
  throw new CliError(
    `${field} '${value}' is not in the catalog (${where}); closest: ${closest.join(', ') || 'none'}. ` +
      '`telenow models list` shows them all; --skip-catalog-check sends it anyway',
    EXIT.usage,
    { code: 'not_in_catalog', details: { field, value, closest } },
  );
}

/** Edit distance (letters added, removed or changed), case-insensitive. */
function distance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}
