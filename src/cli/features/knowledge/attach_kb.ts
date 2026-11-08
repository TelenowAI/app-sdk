/**
 * attach_kb.ts — `telenow kb attach <kb-id> --agent <agent-id> [--doc <id>]… [--whole]`: let an agent answer
 * from a knowledge base, all of it or only some documents.
 *
 * In here: `attachKbCommand` (TELENOW_CLI_PLAN.md §15.2 step 4d; decision D8). The server has two routes,
 * and neither does "attach the whole base" by itself:
 * - `POST …/agents/:agent/knowledge-bases/:kb` with `{ documentIds }` sets the scope to exactly those
 *   documents. With no `documentIds`, a NEW attachment is the whole base, but an EXISTING one keeps its
 *   scope unchanged. The server ignores a body it cannot read (any typo means "no documentIds"), so the
 *   CLI always sends this exact key as JSON.
 * - `PUT …/agents/:agent/knowledge-bases` with `{ knowledgeBases: [{ kbId, documentIds? }] }` replaces the
 *   agent's WHOLE set; a base left out is detached. It has no version check.
 * So the CLI reads the agent's set first (`agent_kbs.ts`):
 * - `--doc` (one or more): POST with those ids (a new attachment, or a changed scope).
 * - `--whole` on a scoped base: PUT with every attached base as it is, this one without `documentIds`.
 *   It then reads the set again; anything that differs from what it sent (someone else saving in between)
 *   is reported, not hidden.
 * - Neither, or `--whole`, on a base not attached: POST with no body, so the whole base.
 * - Neither, on a base attached with a scope: refused (exit 1 `scoped_attachment`): sending it would
 *   silently change nothing.
 * - Already as asked: nothing is sent.
 * The output is the scope it was and the scope it is now, read back from the server.
 * `--dry-run` shows the request after reading the set.
 * Not in here: detaching (`detach_kb.ts`), the listing (`attached_kbs.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, listOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, sendWrite, type WriteRequest } from '../../core/write_request.js';
import { readAgentKbs, scopeOf, type AgentKb } from './agent_kbs.js';
import { AGENT_OPTION, agentKbPath, onKnowledgeOff, requireAgent, safeId } from './kb_paths.js';

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export const attachKbCommand: CommandSpec = {
  path: ['kb', 'attach'],
  summary: 'let an agent answer from a knowledge base (--doc for some documents, --whole for all)',
  args: ['kb-id'],
  options: {
    agent: AGENT_OPTION,
    doc: { type: 'string', value: '<document-id>', multiple: true, help: 'only this document; repeat for more' },
    whole: { type: 'boolean', help: 'the whole base, also when it is now limited to some documents' },
    'dry-run': DRY_RUN_OPTION,
  },
  async run(ctx) {
    const agent = requireAgent(stringOption(ctx.values, 'agent'));
    const kb = safeId(ctx.args['kb-id'], 'a knowledge base id');
    const docs = listOption(ctx.values, 'doc').map((d) => safeId(d, 'a document id'));
    const whole = boolOption(ctx.values, 'whole');
    if (whole && docs.length > 0) throw new CliError('give --doc or --whole, not both', EXIT.usage);

    const before = await readAgentKbs(ctx, agent);
    const current = before.find((r) => r.id === kb);
    const was = scopeOf(current);
    const base = { kbId: kb, agentId: agent, was };

    let req: WriteRequest | undefined;
    let replacing = false;
    if (docs.length > 0) {
      if (current && Array.isArray(current.document_ids) && sameIds(current.document_ids, docs)) req = undefined;
      else req = { method: 'POST', path: await agentKbPath(ctx, agent, `/${kb}`), body: { documentIds: docs } };
    } else if (!current) {
      req = { method: 'POST', path: await agentKbPath(ctx, agent, `/${kb}`) };
    } else if (!Array.isArray(current.document_ids)) {
      req = undefined;
    } else if (whole) {
      replacing = true;
      req = {
        method: 'PUT',
        path: await agentKbPath(ctx, agent, ''),
        body: {
          knowledgeBases: before.map((r: AgentKb) =>
            r.id === kb || !Array.isArray(r.document_ids) ? { kbId: r.id } : { kbId: r.id, documentIds: r.document_ids },
          ),
        },
      };
    } else {
      throw new CliError(
        `the agent already answers from ${kb}, limited to ${current.document_ids.length} document(s); ` +
          '--whole widens it to the whole base, --doc changes the documents',
        EXIT.usage,
        { code: 'scoped_attachment', details: { was } },
      );
    }
    if (!req) return { data: { ...base, now: was, changed: false }, notes: [{ note: 'already as asked; nothing was sent' }] };

    const w = await onKnowledgeOff(sendWrite(ctx, req));
    if (!w.sent) return { data: w.dryRun };
    const after = await readAgentKbs(ctx, agent);
    const now = scopeOf(after.find((r) => r.id === kb));
    const notes: unknown[] = [];
    if (replacing) {
      const sent = (req.body as { knowledgeBases: Array<{ kbId: string; documentIds?: string[] }> }).knowledgeBases;
      const drift = sent.filter((s) => {
        const got = after.find((r) => r.id === s.kbId);
        if (!got) return true;
        return s.documentIds === undefined ? Array.isArray(got.document_ids) : !Array.isArray(got.document_ids) || !sameIds(got.document_ids, s.documentIds);
      });
      const extra = after.filter((r) => !sent.some((s) => s.kbId === r.id));
      if (drift.length > 0 || extra.length > 0) {
        notes.push({
          warning: 'the agent\'s knowledge bases are not exactly what was sent (someone else saved meanwhile?); check telenow kb attached',
          differs: [...drift.map((d) => d.kbId), ...extra.map((r) => r.id)],
        });
      }
    }
    return { data: { ...base, now, changed: true }, raw: w.res.body, notes };
  },
};
