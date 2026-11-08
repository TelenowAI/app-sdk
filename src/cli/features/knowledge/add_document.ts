/**
 * add_document.ts — `telenow kb add-doc <kb-id>`: add one document to a knowledge base.
 *
 * In here: `addDocumentCommand`, one of three sources:
 *   --file <path>        `POST …/documents/upload`, multipart part `file` (+ `title`): PDF, DOCX,
 *                        TXT, MD, CSV, JSON, XLSX, up to the server's limit (20 MB today); the
 *                        server decides by extension and refuses other types
 *   --url <https://…>    `POST …/documents/url` (`{ url, title? }`): the server fetches the page
 *                        (https only, no redirects)
 *   --text-file <path>   `POST …/documents` (`{ title, body }`): the file's text as it is;
 *                        `--title` is required
 * Each answers the new document (201) with `status: "pending"` (or `indexed` for tables); it is
 * searchable once `telenow kb docs` shows `embedded`. The server answers with the document's WHOLE
 * text (`body`) — megabytes for a big file — so the CLI prints a short view without it; `--full`
 * prints everything. `--url` and `--text-file` send an
 * Idempotency-Key; a `--file` upload does not (`core/write_request.ts` says why). `--dry-run`.
 * Not in here: the document list (`list_documents.ts`).
 * Called by: `features/knowledge/register.ts`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { dataOf } from '../../core/api_client.js';
import { CliError, EXIT } from '../../core/cli_error.js';
import { boolOption, stringOption, type CommandSpec } from '../../core/command_spec.js';
import { DRY_RUN_OPTION, IDEMPOTENCY_OPTION, sendWrite, type WriteRequest } from '../../core/write_request.js';
import { kbPath, onKnowledgeOff, safeId } from './kb_paths.js';

export const addDocumentCommand: CommandSpec = {
  path: ['kb', 'add-doc'],
  summary: 'add a document to a knowledge base (--file, --url or --text-file)',
  args: ['kb-id'],
  options: {
    file: { type: 'string', value: '<path>', help: 'upload a PDF, DOCX, TXT, MD, CSV, JSON or XLSX file' },
    url: { type: 'string', value: '<https://…>', help: 'have the server fetch this page' },
    'text-file': { type: 'string', value: '<path>', help: "add this file's text as it is (needs --title)" },
    title: { type: 'string', value: '<title>', help: 'document title (default: from the file or page)' },
    full: { type: 'boolean', help: "print the server's whole answer, including the document text" },
    'dry-run': DRY_RUN_OPTION,
    'idempotency-key': IDEMPOTENCY_OPTION,
  },
  async run(ctx) {
    const base = await kbPath(ctx, `/${safeId(ctx.args['kb-id'], 'a knowledge base id')}/documents`);
    const file = stringOption(ctx.values, 'file');
    const url = stringOption(ctx.values, 'url');
    const textFile = stringOption(ctx.values, 'text-file');
    const title = stringOption(ctx.values, 'title');
    const given = [file, url, textFile].filter((x) => x !== undefined).length;
    if (given !== 1) throw new CliError('give exactly one of --file, --url or --text-file', EXIT.usage);
    let req: WriteRequest;
    if (file !== undefined) {
      req = {
        method: 'POST',
        path: `${base}/upload`,
        file: { field: 'file', path: resolve(ctx.cwd, file) },
        fields: title ? { title } : {},
        creates: true,
      };
    } else if (url !== undefined) {
      if (!/^https:\/\//i.test(url)) throw new CliError('--url must start with https:// (the server fetches https only)', EXIT.usage);
      req = { method: 'POST', path: `${base}/url`, body: { url, title }, creates: true };
    } else {
      const path = resolve(ctx.cwd, textFile as string);
      if (!existsSync(path)) throw new CliError(`no such file: ${path}`, EXIT.usage);
      if (!title?.trim()) throw new CliError('--text-file needs --title', EXIT.usage);
      req = { method: 'POST', path: base, body: { title, body: readFileSync(path, 'utf8') }, creates: true };
    }
    const w = await onKnowledgeOff(sendWrite(ctx, req));
    if (!w.sent) return { data: w.dryRun };
    return {
      data: dataOf(w.res.body),
      defaultFields: boolOption(ctx.values, 'full') ? undefined : ['id', 'kb_id', 'title', 'source_type', 'source_uri', 'status', 'error', 'created_at'],
      raw: w.res.body,
    };
  },
};
