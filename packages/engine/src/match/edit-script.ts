import type { SyntaxNode } from "../parse/tree.js";
import { idOf, type Mapping } from "./matcher.js";
import { longestIncreasing } from "./sequence.js";

/** Half-open UTF-16 offset range into one side's text. */
export interface Span {
  start: number;
  end: number;
}

export type RawEdit =
  | { kind: "insert"; new: Span; node?: string }
  | { kind: "delete"; old: Span; node?: string }
  | { kind: "update" | "move"; old: Span; new: Span; node?: string };

/**
 * Edits implied by a mapping. Inserts and deletes are reported at their outermost node only,
 * and a move only where the node itself changed place, not for everything carried along with it.
 * Anonymous tokens (punctuation, keywords) are never reported as moved: they only follow the named
 * nodes around them, so swapping `f(a, b)` to `f(b, a)` moves an argument, not the comma.
 */
export function editScript({ a, b, src, dst }: Mapping): RawEdit[] {
  const edits: RawEdit[] = [];
  const span = (n: SyntaxNode): Span => ({ start: n.start, end: n.end });
  const partner = (x: SyntaxNode) => b.node(idOf(src, x));

  for (const x of a.nodes) {
    if (src[x.id] === -1) {
      if ((!x.parent || src[x.parent.id] !== -1) && x.end > x.start)
        edits.push({ kind: "delete", old: span(x), node: x.kind });
      continue;
    }
    const y = partner(x);
    if (
      x.children.length === 0 &&
      y.children.length === 0 &&
      x.label !== y.label
    )
      edits.push({ kind: "update", old: span(x), new: span(y), node: x.kind });
    if (x.named && x.parent && (!y.parent || src[x.parent.id] !== y.parent.id))
      edits.push({ kind: "move", old: span(x), new: span(y), node: x.kind });

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
        edits.push({ kind: "move", old: span(c), new: span(p), node: c.kind });
  }
  for (const y of b.nodes) {
    if (
      dst[y.id] === -1 &&
      (!y.parent || dst[y.parent.id] !== -1) &&
      y.end > y.start
    )
      edits.push({ kind: "insert", new: span(y), node: y.kind });
  }
  return edits;
}
