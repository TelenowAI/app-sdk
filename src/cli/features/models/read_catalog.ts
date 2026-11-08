/**
 * read_catalog.ts — the platform's catalog of providers and models, read and flattened.
 *
 * In here:
 * - `fetchCatalog`: `GET /api/catalog` → its `data`. Any key may read it, and it costs nothing.
 * - `catalogKinds`: the kinds the answer holds. These are its keys whose value is a list of
 *   providers (`llm`, `stt`, `tts`, `telephony`, and `s2s` when the server has speech-to-speech
 *   on). They are read from the answer, so a kind the server adds later appears without a CLI
 *   release.
 * - `catalogProviders` (one kind's providers) and `providerModels` (one provider's models).
 * - `modelId`: a model's id, which is `id` for language models, `key` for speech models and
 *   `modelKey` for speech-to-speech.
 * - `catalogRows`: one row per model (or per provider, when it lists no models).
 * The server leaves disabled providers and models out of the catalog.
 * Not in here: printing (`list_models.ts`), checking an agent's choices
 * (`features/agents/check_models.ts`).
 * Called by: `list_models.ts`, `features/agents/check_models.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import type { CommandContext } from '../../core/command_spec.js';

export type Catalog = Record<string, unknown>;
export type CatalogEntry = Record<string, unknown>;

export async function fetchCatalog(ctx: CommandContext): Promise<{ catalog: Catalog; raw: unknown }> {
  const res = await ctx.api().get('/api/catalog');
  const d = dataOf(res.body);
  return { catalog: d && typeof d === 'object' && !Array.isArray(d) ? (d as Catalog) : {}, raw: res.body };
}

function isEntry(x: unknown): x is CatalogEntry {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** A list of providers: every element is an object with a string `id`. */
function isProviderList(v: unknown): v is CatalogEntry[] {
  return Array.isArray(v) && v.every((p) => isEntry(p) && typeof p.id === 'string');
}

export function catalogKinds(catalog: Catalog): string[] {
  return Object.keys(catalog).filter((k) => isProviderList(catalog[k]));
}

export function catalogProviders(catalog: Catalog, kind: string): CatalogEntry[] {
  const v = catalog[kind];
  return isProviderList(v) ? v : [];
}

export function providerModels(provider: CatalogEntry): CatalogEntry[] {
  return Array.isArray(provider.models) ? provider.models.filter(isEntry) : [];
}

export function modelId(m: CatalogEntry): string | null {
  for (const k of ['id', 'key', 'modelKey']) if (typeof m[k] === 'string') return m[k] as string;
  return null;
}

export interface CatalogRow {
  kind: string;
  provider: string;
  providerName: unknown;
  model: string | null;
  name: unknown;
  recommended: unknown;
  /** The model's whole entry (prices, limits, abilities); the provider's when it lists no models. */
  details: CatalogEntry;
}

export function catalogRows(catalog: Catalog): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const kind of catalogKinds(catalog)) {
    for (const p of catalogProviders(catalog, kind)) {
      const models = providerModels(p);
      const { models: _models, ...providerOnly } = p;
      if (models.length === 0) {
        rows.push({
          kind,
          provider: p.id as string,
          providerName: p.name ?? null,
          model: null,
          name: p.name ?? null,
          recommended: p.recommended ?? null,
          details: providerOnly,
        });
        continue;
      }
      for (const m of models) {
        rows.push({
          kind,
          provider: p.id as string,
          providerName: p.name ?? null,
          model: modelId(m),
          name: m.name ?? null,
          recommended: m.recommended ?? null,
          details: m,
        });
      }
    }
  }
  return rows;
}
