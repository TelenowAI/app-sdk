/**
 * kb_paths.ts — what every knowledge-base command shares.
 *
 * In here: `AGENT_OPTION` + `requireAgent` (`--agent` for attach / detach), `kbPath` (`/api/orgs/<org>/knowledge-bases` + suffix), `agentKbPath`
 * (`/api/orgs/<org>/agents/<agent>/knowledge-bases` + suffix), `safeId` (an id that goes into a
 * path) and `onKnowledgeOff`: the server mounts these routes only when its Knowledge module is on
 * (it needs an embeddings endpoint), so a 404 whose message is not a "not found" of a knowledge
 * base or document means the module is off — said in words, still exit 3.
 * Not in here: the commands.
 * Called by: every file in `features/knowledge/`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import type { CommandContext } from '../../core/command_spec.js';

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function safeId(raw: string, what: string): string {
  if (!SAFE.test(raw)) throw new CliError(`'${raw}' is not ${what}`, EXIT.usage);
  return raw;
}

export async function kbPath(ctx: CommandContext, suffix: string): Promise<string> {
  return ctx.orgPath(`/knowledge-bases${suffix}`);
}

export async function agentKbPath(ctx: CommandContext, agentId: string, suffix: string): Promise<string> {
  return ctx.orgPath(`/agents/${safeId(agentId, 'an agent id')}/knowledge-bases${suffix}`);
}

export async function onKnowledgeOff<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof CliError && e.status === 404 && !/knowledge base|document|agent/i.test(e.message)) {
      throw new CliError(
        'knowledge bases are not available on this server (its Knowledge module is off)',
        EXIT.notFound,
        { status: 404, code: 'knowledge_module_off' },
      );
    }
    throw e;
  }
}

export const AGENT_OPTION = { type: 'string' as const, value: '<agent-id>', help: 'the agent (required)' };

export function requireAgent(v: string | undefined): string {
  if (!v) throw new CliError('--agent is required', EXIT.usage);
  return v;
}
