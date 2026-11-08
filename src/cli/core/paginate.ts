/**
 * paginate.ts — one page, or `--all` pages, of an offset-paged list.
 *
 * In here: `fetchPages`. It advances by the number of rows a page actually returned (so a
 * server that clamps the page size still pages correctly) and stops at an empty page or once
 * `total` is reached. With one page, it reports where the next page starts.
 * Not in here: the routes themselves (each list command passes its own `fetchPage`).
 * Called by: `agents list`, `calls list`.
 */

export interface Page<T> {
  items: T[];
  /** The server's row count for the whole list; `null` when it does not say. */
  total: number | null;
}

export interface PagedResult<T> {
  items: T[];
  total: number | null;
  /** Where the next page starts, when there is one and `--all` was not given. */
  nextOffset: number | null;
}

/**
 * The page size `--all` asks for when `--limit` is not given: the most the agent and call
 * lists serve per request (`MAX_LIST_LIMIT` / the calls route's clamp), so `--all` makes as
 * few requests as the server allows.
 */
export const ALL_PAGE_SIZE = 200;

export async function fetchPages<T>(
  fetchPage: (offset: number, limit: number | undefined) => Promise<Page<T>>,
  opts: { offset: number; limit?: number; all: boolean },
): Promise<PagedResult<T>> {
  if (!opts.all) {
    const p = await fetchPage(opts.offset, opts.limit);
    const end = opts.offset + p.items.length;
    const more = p.total !== null && p.items.length > 0 && end < p.total;
    return { items: p.items, total: p.total, nextOffset: more ? end : null };
  }
  const items: T[] = [];
  let offset = opts.offset;
  let total: number | null = null;
  for (;;) {
    const p = await fetchPage(offset, opts.limit ?? ALL_PAGE_SIZE);
    total = p.total;
    items.push(...p.items);
    offset += p.items.length;
    if (p.items.length === 0 || (total !== null && offset >= total)) break;
  }
  return { items, total, nextOffset: null };
}
