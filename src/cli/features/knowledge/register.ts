/**
 * register.ts — the knowledge-base commands, in the order `telenow --help` lists them.
 *
 * Files in this folder:
 *   list_kbs.ts        telenow kb list      the org's knowledge bases
 *   get_kb.ts          telenow kb get       one, with its document count
 *   create_kb.ts       telenow kb create    a new, empty one
 *   add_document.ts    telenow kb add-doc   a file, a web page or a text file
 *   list_documents.ts  telenow kb docs      documents and whether each is ready
 *   attach_kb.ts       telenow kb attach    let an agent answer from it (all, or --doc some documents)
 *   attached_kbs.ts    telenow kb attached  the bases an agent answers from, and which documents
 *   agent_kbs.ts       an agent's attached bases and their scope, shared
 *   detach_kb.ts       telenow kb detach    stop an agent answering from it
 *   delete_kb.ts       telenow kb delete    asks first, or --yes
 *   kb_paths.ts        paths, ids, and "the Knowledge module is off" for all of the above
 * Called by: `main.ts`.
 */

import type { CommandSpec } from '../../core/command_spec.js';
import { addDocumentCommand } from './add_document.js';
import { attachKbCommand } from './attach_kb.js';
import { attachedKbsCommand } from './attached_kbs.js';
import { createKbCommand } from './create_kb.js';
import { deleteKbCommand } from './delete_kb.js';
import { detachKbCommand } from './detach_kb.js';
import { getKbCommand } from './get_kb.js';
import { listDocumentsCommand } from './list_documents.js';
import { listKbsCommand } from './list_kbs.js';

export const knowledgeCommands: CommandSpec[] = [
  listKbsCommand,
  getKbCommand,
  createKbCommand,
  addDocumentCommand,
  listDocumentsCommand,
  attachKbCommand,
  attachedKbsCommand,
  detachKbCommand,
  deleteKbCommand,
];
