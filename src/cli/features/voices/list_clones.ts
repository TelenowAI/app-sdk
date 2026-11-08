/**
 * list_clones.ts — `telenow voices clones --provider <p>`: the org's cloned voices on a provider.
 *
 * In here: `listClonesCommand` → `GET /api/orgs/:orgId/voices/clones?provider=<p>`:
 * `data.clones` — `voice_profile_id`, `profile_name`, `provider`, `provider_voice_id` (what
 * `ttsVoice` takes), `key_scope`, `languages`.
 * Not in here: the provider's own voices (`list_voices.ts`); making a clone (dashboard only).
 * Called by: `features/voices/register.ts`.
 */

import { dataOf } from '../../core/api_client.js';
import { stringOption, type CommandSpec } from '../../core/command_spec.js';
import { providerArg } from './provider_arg.js';

export const listClonesCommand: CommandSpec = {
  path: ['voices', 'clones'],
  summary: "list the org's cloned voices on a provider",
  options: { provider: { type: 'string', value: '<provider>', help: 'the TTS provider (required)' } },
  async run(ctx) {
    const provider = providerArg(stringOption(ctx.values, 'provider'));
    const res = await ctx.api().get(await ctx.orgPath('/voices/clones'), { query: { provider } });
    const d = dataOf(res.body) as { clones?: unknown } | null;
    return { data: Array.isArray(d?.clones) ? d.clones : [], raw: res.body };
  },
};
