import { NO_NODE, type Tree } from "../core/arena.js";

/**
 * The tree the formatter reads: the arena `Tree` without offsets, so a rule learns about layout only through
 * `lf`, `adjoins`, `col` and token text, never by probing the source around a position.
 */
export type FormatTree = Pick<
  Tree,
  | "root"
  | "nodeCount"
  | "trailingLf"
  | "bom"
  | "frontMatter"
  | "kind"
  | "kindName"
  | "named"
  | "missing"
  | "field"
  | "fieldName"
  | "count"
  | "child"
  | "parent"
  | "text"
  | "lf"
  | "ord"
  | "at"
  | "adjoins"
  | "col"
>;

/** The first leaf of `n`: `n` itself when it is one. */
export function firstLeaf(tree: FormatTree, n: number): number {
  while (tree.count(n) > 0) n = tree.child(n, 0);
  return n;
}

/** The leaf after `n` and all of its leaves, in source order; `NO_NODE` at the end of the file. */
export function nextLeaf(tree: FormatTree, n: number): number {
  // Postorder puts a subtree's nodes just before it, so what follows `n` is the next leaf or an ancestor.
  for (let o = tree.ord(n) + 1; o < tree.nodeCount; o++) {
    const l = tree.at(o);
    if (tree.count(l) === 0) return l;
  }
  return NO_NODE;
}

/** The leaf before `n`'s first leaf, in source order; `NO_NODE` at the start of the file. */
export function prevLeaf(tree: FormatTree, n: number): number {
  for (let o = tree.ord(firstLeaf(tree, n)) - 1; o >= 0; o--) {
    const l = tree.at(o);
    if (tree.count(l) === 0) return l;
  }
  return NO_NODE;
}
