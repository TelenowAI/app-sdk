/**
 * pick_fields.ts — `--fields a,b.c`: keep only the named fields of the output.
 *
 * In here: `parseFields` (the flag's text → paths) and `pickFields` (the projection).
 * Rules: a path is dot-separated; an array anywhere on the path is mapped item by item
 * (`transcript.text` keeps `text` of every turn); a field that is absent is left out, not
 * printed as null; the whole output, if it is an array, is projected item by item.
 * Not in here: printing (`print_output.ts`).
 * Called by: `print_output.ts`, commands that project their default columns.
 */

export function parseFields(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const paths = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return paths.length > 0 ? paths : undefined;
}

export function pickFields(value: unknown, paths: string[]): unknown {
  return pickTree(value, toTree(paths));
}

interface Tree {
  [key: string]: Tree | true;
}

function toTree(paths: string[]): Tree {
  const root: Tree = {};
  for (const p of paths) {
    const segs = p.split('.').filter((s) => s.length > 0);
    let node: Tree = root;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const last = i === segs.length - 1;
      const cur = node[s];
      if (last) {
        node[s] = true; // the whole value wins over any narrower path
      } else if (cur === true) {
        break;
      } else {
        node = node[s] = cur ?? {};
      }
    }
  }
  return root;
}

function pickTree(value: unknown, tree: Tree): unknown {
  if (Array.isArray(value)) return value.map((v) => pickTree(v, tree));
  if (!value || typeof value !== 'object') return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(tree)) {
    if (!(key in src)) continue;
    out[key] = sub === true ? src[key] : pickTree(src[key], sub);
  }
  return out;
}
