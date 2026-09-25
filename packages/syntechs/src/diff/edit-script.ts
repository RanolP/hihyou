import type { SyntaxNode, SyntaxTree } from "../core/tree.js";
import { idOf, type Mapping } from "./matcher.js";
import { longestIncreasing } from "./sequence.js";

/** Half-open UTF-16 offset range into one side's text. */
export interface Span {
  start: number;
  end: number;
}

/** `a` and `b` are the old and new nodes the edit is about; absent in line mode. */
export type RawEdit =
  | { kind: "insert"; new: Span; node?: string; b?: SyntaxNode }
  | { kind: "delete"; old: Span; node?: string; a?: SyntaxNode }
  | {
      kind: "update" | "move";
      old: Span;
      new: Span;
      node?: string;
      a?: SyntaxNode;
      b?: SyntaxNode;
    };

/** Per-node flags, by preorder id, for subtrees another file's diff already explains (a declaration moved across files). */
export interface Claimed {
  a: Uint8Array;
  b: Uint8Array;
}

/**
 * Edits implied by a mapping. Inserts and deletes are reported at their outermost node only,
 * and a move only where the node itself changed place, not for everything carried along with it.
 * Anonymous tokens (punctuation, keywords) are never reported as moved: they only follow the named
 * nodes around them, so swapping `f(a, b)` to `f(b, a)` moves an argument, not the comma.
 * Claimed subtrees produce nothing here; an unmatched node holding one is reported piece by piece
 * around it, so deleting a file whose function moved elsewhere does not delete that function too.
 */
export function editScript(
  { a, b, src, dst }: Mapping,
  claimed?: Claimed,
): RawEdit[] {
  const edits: RawEdit[] = [];
  const span = (n: SyntaxNode): Span => ({ start: n.start, end: n.end });
  const partner = (x: SyntaxNode) => b.node(idOf(src, x));
  const holdsA = holdingClaimed(a, claimed?.a);
  const holdsB = holdingClaimed(b, claimed?.b);
  // Outermost: its parent is matched, or is itself reported piece by piece.
  const outermost = (n: SyntaxNode, table: Int32Array, holds: Uint8Array) =>
    !n.parent || table[n.parent.id] !== -1 || holds[n.parent.id] === 1;

  for (const x of a.nodes) {
    if (claimed?.a[x.id]) continue;
    if (src[x.id] === -1) {
      if (!holdsA[x.id] && outermost(x, src, holdsA) && x.end > x.start)
        edits.push({ kind: "delete", old: span(x), node: x.kind, a: x });
      continue;
    }
    const y = partner(x);
    const pair = { old: span(x), new: span(y), node: x.kind, a: x, b: y };
    if (
      x.children.length === 0 &&
      y.children.length === 0 &&
      x.label !== y.label
    )
      edits.push({ kind: "update", ...pair });
    if (x.named && x.parent && (!y.parent || src[x.parent.id] !== y.parent.id))
      edits.push({ kind: "move", ...pair });

    // Reordering among children that stayed under the same parent: whatever falls outside the longest in-order run moved.
    const stayed = x.children
      .filter((c) => c.named && src[c.id] !== -1)
      .map((c) => ({ c, p: partner(c) }))
      .filter(({ p }) => p.parent === y);
    if (stayed.length < 2) continue;
    const position = new Map(y.children.map((c, i) => [c, i]));
    const kept = longestIncreasing(
      stayed.map(({ p }) => position.get(p) ?? -1),
    );
    for (const [i, { c, p }] of stayed.entries())
      if (!kept.has(i))
        edits.push({
          kind: "move",
          old: span(c),
          new: span(p),
          node: c.kind,
          a: c,
          b: p,
        });
  }
  for (const y of b.nodes) {
    if (claimed?.b[y.id]) continue;
    if (
      dst[y.id] === -1 &&
      !holdsB[y.id] &&
      outermost(y, dst, holdsB) &&
      y.end > y.start
    )
      edits.push({ kind: "insert", new: span(y), node: y.kind, b: y });
  }
  return edits;
}

/** 1 for every proper ancestor of a claimed node. */
function holdingClaimed(
  tree: SyntaxTree,
  claimed: Uint8Array | undefined,
): Uint8Array {
  const holds = new Uint8Array(tree.nodes.length);
  if (!claimed) return holds;
  for (const n of tree.nodes)
    if (claimed[n.id] && !(n.parent && claimed[n.parent.id]))
      for (let p = n.parent; p && !holds[p.id]; p = p.parent) holds[p.id] = 1;
  return holds;
}
