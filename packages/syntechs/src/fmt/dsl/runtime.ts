// What the generated formatters (`fmt.gen.ts`) and the two-pass reference (`reference.ts`) share: how a spec's
// references bind to a node's children, so both print the same source token for the same spec token.
import type { StreamCtx } from "../stream-format.js";
import type { FormatTree } from "../tree.js";

/** The first child of `node` in field `name`; -1 when there is none. */
export function fieldChild(tree: FormatTree, node: number, name: string): number {
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (tree.fieldName(c) === name) return c;
  }
  return -1;
}

/** The `nth` anonymous child of `node` spelled `text` (a spec's `nth` token `text` binds to it); -1 when none. */
export function tokenChild(
  tree: FormatTree,
  node: number,
  text: string,
  nth: number,
): number {
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (!tree.named(c) && tree.kindName(c) === text && nth-- === 0) return c;
  }
  return -1;
}

/**
 * The items of a list reference: `children` (named, not comments, in no field; every item when the kind has no
 * fields at all) or the children in field `name`.
 */
export function listItems<O>(
  ctx: StreamCtx<O>,
  node: number,
  name: string,
  kindHasFields: boolean,
): number[] {
  const items = ctx.items(node);
  if (name !== "children")
    return items.filter((c) => ctx.tree.fieldName(c) === name);
  return kindHasFields
    ? items.filter((c) => ctx.tree.fieldName(c) === undefined)
    : items;
}

/** For each item but the last, the separator token `sep` after it; -1 where the source has none. */
export function separators(
  tree: FormatTree,
  node: number,
  items: readonly number[],
  sep: string,
): number[] {
  const seps: number[] = new Array(Math.max(items.length - 1, 0)).fill(-1);
  let seen = 0;
  for (let i = 0, count = tree.count(node); i < count; i++) {
    const c = tree.child(node, i);
    if (c === items[seen]) seen++;
    else if (
      seen > 0 &&
      seen <= seps.length &&
      seps[seen - 1] === -1 &&
      !tree.named(c) &&
      tree.kindName(c) === sep
    )
      seps[seen - 1] = c;
  }
  return seps;
}
