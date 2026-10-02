import type { Tree } from "../core/arena.js";
import type { Mapping } from "./matcher.js";

/**
 * How a matched node that changed place reads: `pure` carried every token across, `edited` kept at least
 * `minSimilarity` of them, and `replaced` is honestly a delete plus an insert, either because too little
 * survived or because the node is too small (`return null;`, one identifier) for "moved" to mean anything.
 */
export type MoveClass = "pure" | "edited" | "replaced";

export interface MoveOptions {
  /**
   * Both subtrees need at least this many nodes. The AST counterpart of git's 20 alphanumeric characters
   * and Phabricator's 3 lines of 30: a smaller move stays a plain edit.
   */
  minNodes: number;
  /**
   * Leaf-token dice at or above which a changed move is still shown as moved. GumTree's paper value,
   * applied to the final mapping rather than the partial one the matcher decides on, so it stays a
   * display threshold even if `MatchOptions.minDice` is tuned down.
   */
  minSimilarity: number;
}

export const defaultMoveOptions: MoveOptions = {
  minNodes: 8,
  minSimilarity: 0.5,
};

/**
 * Whether base leaf `x` and its head partner `y` (side indices) read the same. The seam for normalization
 * and approved rules: a leaf that differs only by an approved rename should answer true here, so a moved and
 * renamed block reads as a pure move. The default compares token labels.
 */
export type SameLeaf = (x: number, y: number) => boolean;

/**
 * Classifies the move of base index `x` to head index `y` by `2 * U / (L(x) + L(y))`, where `L` counts the
 * non-empty leaf tokens of a subtree and `U` those of `x` whose partner is a leaf of `y` that reads the same.
 * Pass the final mapping: after recovery, and after anything that unmatches nodes.
 */
export function classifyMove(
  { a, b, src }: Mapping,
  x: number,
  y: number,
  opts: MoveOptions = defaultMoveOptions,
  sameLeaf: SameLeaf = (p, q) =>
    a.tree.label(a.node(p)) === b.tree.label(b.node(q)),
): MoveClass {
  const xs = a.size[x] as number;
  const ys = b.size[y] as number;
  if (Math.min(xs, ys) < opts.minNodes) return "replaced";
  // `const start = max(v, 0)` and a new `const first = floor(max(v, 0) / n)` share most tokens, but a different
  // name is a different declaration: pairing them shows the old one moved when its value was only inlined.
  const nameX = nameOf(a.tree, a.node(x));
  const nameY = nameOf(b.tree, b.node(y));
  if (nameX !== undefined && nameY !== undefined && nameX !== nameY)
    return "replaced";
  const isLeaf = (side: Mapping["a"], i: number) => {
    if (side.size[i] !== 1) return false;
    const n = side.node(i);
    return side.tree.end(n) > side.tree.start(n);
  };
  let leavesX = 0;
  let unchanged = 0;
  for (let i = x; i < x + xs; i++) {
    if (!isLeaf(a, i)) continue;
    leavesX++;
    const p = src[i] as number;
    if (p >= y && p < y + ys && isLeaf(b, p) && sameLeaf(i, p)) unchanged++;
  }
  let leavesY = 0;
  for (let i = y; i < y + ys; i++) if (isLeaf(b, i)) leavesY++;
  const total = leavesX + leavesY;
  const s = total === 0 ? 1 : (2 * unchanged) / total;
  return s === 1 ? "pure" : s >= opts.minSimilarity ? "edited" : "replaced";
}

/**
 * The name a declaration introduces: its `name` field, through an `export` (default or not), a Python
 * decorator, or a single `const x = ...`.
 */
export function nameOf(tree: Tree, n: number): string | undefined {
  const named: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.named(c)) named.push(c);
  }
  const name = named.find((c) => tree.fieldName(c) === "name");
  if (name !== undefined)
    return tree.count(name) === 0 ? tree.label(name) : undefined;
  const inner =
    named.find((c) => {
      const field = tree.fieldName(c);
      return field === "declaration" || field === "definition";
    }) ?? (named.length === 1 ? named[0] : undefined);
  return inner !== undefined ? nameOf(tree, inner) : undefined;
}
