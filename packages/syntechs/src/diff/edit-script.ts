import type { Tree } from "../core/arena.js";
import type { Mapping } from "./matcher.js";
import {
  classifyMove,
  defaultMoveOptions,
  type MoveClass,
  type MoveOptions,
} from "./move.js";
import { longestIncreasing } from "./sequence.js";
import type { Side } from "./side.js";

/** Half-open UTF-16 offset range into one side's text. */
export interface Span {
  start: number;
  end: number;
}

/** `a` and `b` are handles of the old and new nodes the edit is about, in `EditScript.a` and `.b`; absent in line mode. */
export type RawEdit =
  | { kind: "insert"; new: Span; node?: string; b?: number }
  | { kind: "delete"; old: Span; node?: string; a?: number }
  | {
      kind: "update";
      old: Span;
      new: Span;
      node?: string;
      a?: number;
      b?: number;
    }
  | {
      kind: "move";
      old: Span;
      new: Span;
      node?: string;
      a?: number;
      b?: number;
      /** The moved code also changed inside (`classifyMove` said `edited`); absent for a pure move. */
      edited?: true;
    };

/** Edits between two trees, whose nodes they name by handle. */
export interface EditScript {
  a: Tree;
  b: Tree;
  edits: RawEdit[];
}

/** Per-node flags, by side index, for subtrees another file's diff already explains (a declaration moved across files). */
export interface Claimed {
  a: Uint8Array;
  b: Uint8Array;
}

/**
 * Edits implied by a mapping. Inserts and deletes are reported at their outermost node only,
 * and a move only where the node itself changed place, not for everything carried along with it.
 * Anonymous tokens (punctuation, keywords) are never reported as moved: they only follow the named
 * nodes around them, so swapping `f(a, b)` to `f(b, a)` moves an argument, not the comma.
 * A move `classifyMove` calls `replaced` is reported as a delete plus an insert instead.
 * Claimed subtrees produce nothing here; an unmatched node holding one is reported piece by piece
 * around it, so deleting a file whose function moved elsewhere does not delete that function too.
 */
export function editScript(
  mapping: Mapping,
  claimed?: Claimed,
  moveOpts: MoveOptions = defaultMoveOptions,
): EditScript {
  const { a, b, src, dst, kinds } = settleMoves(mapping, moveOpts);
  const ta = a.tree;
  const tb = b.tree;
  const edits: RawEdit[] = [];
  const span = (t: Tree, n: number): Span => ({
    start: t.start(n),
    end: t.end(n),
  });
  const holdsA = holdingClaimed(a, claimed?.a);
  const holdsB = holdingClaimed(b, claimed?.b);
  // Outermost: its parent is matched, or is itself reported piece by piece.
  const outermost = (
    side: Side,
    i: number,
    table: Int32Array,
    holds: Uint8Array,
  ) => {
    const p = side.parentOf(i);
    return p === -1 || table[p] !== -1 || holds[p] === 1;
  };

  for (let x = 0; x < a.nodes.length; x++) {
    if (claimed?.a[x]) continue;
    const hx = a.node(x);
    const y = src[x] as number;
    if (y === -1) {
      if (
        !holdsA[x] &&
        outermost(a, x, src, holdsA) &&
        ta.end(hx) > ta.start(hx)
      )
        edits.push({
          kind: "delete",
          old: span(ta, hx),
          node: ta.kindName(hx),
          a: hx,
        });
      continue;
    }
    const hy = b.node(y);
    if (a.size[x] === 1 && b.size[y] === 1 && ta.label(hx) !== tb.label(hy))
      edits.push({
        kind: "update",
        old: span(ta, hx),
        new: span(tb, hy),
        node: ta.kindName(hx),
        a: hx,
        b: hy,
      });
    for (const [p, q] of movesAt(a, b, src, x)) {
      const hp = a.node(p);
      const hq = b.node(q);
      edits.push({
        kind: "move",
        old: span(ta, hp),
        new: span(tb, hq),
        node: ta.kindName(hp),
        a: hp,
        b: hq,
        ...(kinds.get(p) === "edited" && { edited: true as const }),
      });
    }
  }
  for (let y = 0; y < b.nodes.length; y++) {
    if (claimed?.b[y]) continue;
    const hy = b.node(y);
    if (
      dst[y] === -1 &&
      !holdsB[y] &&
      outermost(b, y, dst, holdsB) &&
      tb.end(hy) > tb.start(hy)
    )
      edits.push({
        kind: "insert",
        new: span(tb, hy),
        node: tb.kindName(hy),
        b: hy,
      });
  }
  return { a: ta, b: tb, edits };
}

/**
 * Moves owned by base index `x`, as (base, head) index pairs: `x` itself when its parent's partner is not
 * its new parent, then those of its children that stayed under its partner but fell out of order.
 */
function movesAt(
  a: Side,
  b: Side,
  src: Int32Array,
  x: number,
): [number, number][] {
  const y = src[x] as number;
  if (y === -1) return [];
  const out: [number, number][] = [];
  const px = a.parentOf(x);
  const py = b.parentOf(y);
  if (a.tree.named(a.node(x)) && px !== -1 && (py === -1 || src[px] !== py))
    out.push([x, y]);

  // Reordering among children that stayed under the same parent: whatever falls outside the longest in-order run moved.
  const stayed = a
    .childrenOf(x)
    .filter((c) => a.tree.named(a.node(c)) && src[c] !== -1)
    .map((c) => ({ c, p: src[c] as number }))
    .filter(({ p }) => b.parentOf(p) === y);
  if (stayed.length < 2) return out;
  const position = new Map(b.childrenOf(y).map((c, i) => [c, i]));
  const kept = longestIncreasing(stayed.map(({ p }) => position.get(p) ?? -1));
  for (const [i, { c, p }] of stayed.entries())
    if (!kept.has(i)) out.push([c, p]);
  return out;
}

/**
 * A copy of `mapping` in which every move `classifyMove` calls `replaced` is unmatched, subtree and all, so
 * it reads as a delete plus an insert; `kinds` holds the class of each move left, by base index. Unmatching
 * one move changes the score of a move around it, so this repeats until nothing more is dropped.
 */
function settleMoves(
  mapping: Mapping,
  opts: MoveOptions,
): Mapping & { kinds: Map<number, MoveClass> } {
  const { a, b } = mapping;
  const settled = { a, b, src: mapping.src.slice(), dst: mapping.dst.slice() };
  const { src, dst } = settled;
  const unmatch = (
    own: Int32Array,
    other: Int32Array,
    i: number,
    size: number,
  ) => {
    for (let k = i; k < i + size; k++) {
      const partner = own[k] as number;
      if (partner === -1) continue;
      other[partner] = -1;
      own[k] = -1;
    }
  };
  const kinds = new Map<number, MoveClass>();
  for (let dropped = true; dropped;) {
    dropped = false;
    kinds.clear();
    for (let x = 0; x < a.nodes.length; x++)
      for (const [p, q] of movesAt(a, b, src, x)) {
        // An earlier move in this pass may have unmatched it already.
        if (src[p] !== q) continue;
        const kind = classifyMove(settled, p, q, opts);
        if (kind !== "replaced") {
          kinds.set(p, kind);
          continue;
        }
        unmatch(src, dst, p, a.size[p] as number);
        unmatch(dst, src, q, b.size[q] as number);
        dropped = true;
      }
  }
  return { ...settled, kinds };
}

/** 1 for every proper ancestor of a claimed node. */
function holdingClaimed(
  side: Side,
  claimed: Uint8Array | undefined,
): Uint8Array {
  const holds = new Uint8Array(side.nodes.length);
  if (!claimed) return holds;
  for (let i = 0; i < holds.length; i++) {
    if (!claimed[i]) continue;
    const up = side.parentOf(i);
    if (up !== -1 && claimed[up]) continue;
    for (let p = up; p !== -1 && !holds[p]; p = side.parentOf(p)) holds[p] = 1;
  }
  return holds;
}
