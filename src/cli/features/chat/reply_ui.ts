/**
 * reply_ui.ts — what an agent attached to a chat reply (`ui`), as text for a terminal.
 *
 * In here: `replyOptions` and `describeUi`. When the agent's owner turned rich replies on, a reply
 * may carry `ui` of one of three kinds:
 * - `options` to pick from (`[{ id, title, description? }]`);
 * - one `link` (`label`, `url`);
 * - one `file` from the org's library (`name`, `mime`, `sizeBytes`, a signed `url`).
 * `shownAs: "text"` means the reply's own words already list them, so nothing more is drawn. A
 * kind this CLI does not know is left out: the reply reads on its own.
 * - `replyOptions(ui)` gives the options (for answering one by its number);
 * - `describeUi(ui)` gives the lines to print under the reply: options as "  1. Title — description",
 *   a link as "  [label] url", a file as "  file: name (mime, size) url". It gives '' when there
 *   is nothing to add.
 * Not in here: sending the chosen option (`chat_turn.ts`, `optionId`).
 * Called by: `chat_terminal.ts`, `chat_messages.ts`.
 */

export interface ReplyOption {
  id: string;
  title: string;
  description?: string;
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function replyOptions(ui: unknown): ReplyOption[] {
  if (!isObject(ui) || ui.kind !== 'options' || !Array.isArray(ui.options)) return [];
  return ui.options
    .filter((o): o is Record<string, unknown> => isObject(o) && typeof o.id === 'string' && typeof o.title === 'string')
    .map((o) => ({ id: o.id as string, title: o.title as string, ...(typeof o.description === 'string' ? { description: o.description } : {}) }));
}

export function describeUi(ui: unknown): string {
  if (!isObject(ui) || ui.shownAs === 'text') return '';
  if (ui.kind === 'options') {
    return replyOptions(ui)
      .map((o, i) => `  ${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`)
      .join('\n');
  }
  if (ui.kind === 'link' && typeof ui.url === 'string') {
    return `  [${typeof ui.label === 'string' ? ui.label : 'link'}] ${ui.url}`;
  }
  if (ui.kind === 'file' && typeof ui.url === 'string') {
    const facts = [ui.mime, typeof ui.sizeBytes === 'number' ? `${ui.sizeBytes} bytes` : undefined].filter((x) => typeof x === 'string');
    return `  file: ${typeof ui.name === 'string' ? ui.name : 'file'}${facts.length ? ` (${facts.join(', ')})` : ''} ${ui.url}`;
  }
  return '';
}
