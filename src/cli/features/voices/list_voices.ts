/**
 * list_voices.ts — `telenow voices list --provider <p>`: the voices a provider offers, to pick
 * an agent's `ttsVoice` from.
 *
 * In here: `listVoicesCommand` → `GET /api/providers/tts/:provider/voices` (`model`): `data` is a
 * list of voices — `id` (what `ttsVoice` takes), `name`, `language`, `languages`, `gender`,
 * `accent`, `preview_url`, … The route has no language or gender filter, so `--language`,
 * `--gender` and `--limit` are applied here:
 * - language: a voice matches when its `language` or one of its `languages` is the given text,
 *   or starts with it followed by `-` / `_` (`hi` matches `hi-IN`), ignoring case — so a code or
 *   a full name both work;
 * - gender: equal, ignoring case.
 * When the server could not read the provider's list it answers `source: "fallback"` (often an
 * empty list); that is said on stderr.
 * Not in here: the org's own cloned voices (`list_clones.ts`).
 * Called by: `features/voices/register.ts`.
 */

import { boolOption, intOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { dataOf } from '../../core/api_client.js';
import { providerArg } from './provider_arg.js';

function speaks(voice: Record<string, unknown>, want: string): boolean {
  const w = want.toLowerCase();
  const langs = [voice.language, ...(Array.isArray(voice.languages) ? voice.languages : [])].filter((x): x is string => typeof x === 'string');
  return langs.some((l) => {
    const x = l.toLowerCase();
    return x === w || x.startsWith(w + '-') || x.startsWith(w + '_');
  });
}

export const listVoicesCommand: CommandSpec = {
  path: ['voices', 'list'],
  summary: "list a provider's voices, to pick an agent's ttsVoice",
  options: {
    provider: { type: 'string', value: '<provider>', help: 'the TTS provider, e.g. elevenlabs (required)' },
    model: { type: 'string', value: '<model>', help: "only voices for this provider model" },
    language: { type: 'string', value: '<code|name>', help: 'e.g. hi, hi-IN or Hindi' },
    gender: { type: 'string', value: '<gender>', help: 'e.g. female' },
    limit: { type: 'string', value: '<n>', help: 'at most this many' },
    full: { type: 'boolean', help: 'print every field, not the short view' },
  },
  async run(ctx) {
    const v = ctx.values;
    const provider = providerArg(stringOption(v, 'provider'));
    const res = await ctx.api().get(`/api/providers/tts/${provider}/voices`, { query: { model: stringOption(v, 'model') } });
    let voices = (dataOf(res.body) ?? []) as Record<string, unknown>[];
    if (!Array.isArray(voices)) voices = [];
    const language = stringOption(v, 'language');
    const gender = stringOption(v, 'gender')?.toLowerCase();
    if (language) voices = voices.filter((x) => speaks(x, language));
    if (gender) voices = voices.filter((x) => typeof x.gender === 'string' && x.gender.toLowerCase() === gender);
    const limit = intOption(v, 'limit', 1);
    if (limit !== undefined) voices = voices.slice(0, limit);
    const source = (res.body as { source?: unknown } | null)?.source;
    return {
      data: voices,
      defaultFields: boolOption(v, 'full') ? undefined : ['id', 'name', 'language', 'gender', 'accent', 'preview_url'],
      notes: source === 'fallback' ? [{ warning: `the server could not read ${provider}'s voice list; these are fallback voices (often none)` }] : [],
      raw: res.body,
    };
  },
};
