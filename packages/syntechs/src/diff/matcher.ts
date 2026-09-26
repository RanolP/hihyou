import { commonPairs } from "./sequence.js";
import type { Side } from "./side.js";

export interface MatchOptions {
  /** Top-down phase ignores subtrees lower than this; single tokens are left to the bottom-up recovery. */
  minHeight: number;
  /** Bottom-up phase pairs two containers when this share of their descendants is already matched. */
  minDice: number;
}

export const defaultMatchOptions: MatchOptions = { minHeight: 2, minDice: 0.5 };

const maxAmbiguousPairs = 10_000;

/**
 * Descendants the similarity scoring may visit in one `match`. The bottom-up phase is cubic on deep
 * nesting (a long method chain), so past this the caller gets `MatchBudgetExceeded` instead of a stall.
 */
const maxDiceWork = 200_000_000;

export class MatchBudgetExceeded extends Error {
  constructor() {
    super(`tree matching exceeded its budget of ${maxDiceWork} dice steps`);
    this.name = "MatchBudgetExceeded";
  }
}

/** A one-to-one node mapping between old side `a` and new side `b`, by side index; -1 means unmatched. */
export interface Mapping {
  a: Side;
  b: Side;
  src: Int32Array;
  dst: Int32Array;
}

/** GumTree (Falleri et al. 2014): greedy top-down isomorphic subtrees, then bottom-up container matching with recovery. */
export function match(
  a: Side,
  b: Side,
  opts: MatchOptions = defaultMatchOptions,
): Mapping {
  const intern = new Map<string, number>();
  const isoA = isoIds(a, intern);
  const isoB = isoIds(b, intern);
  const sizeA = a.size;
  const sizeB = b.size;
  const src = new Int32Array(sizeA.length).fill(-1);
  const dst = new Int32Array(sizeB.length).fill(-1);
  const ta = a.tree;
  const tb = b.tree;
  // Kinds and fields compare by name: a cross-file match can pair two languages' trees (TypeScript and TSX).
  const kindA = (x: number) => ta.kindName(a.nodes[x] as number);
  const kindB = (y: number) => tb.kindName(b.nodes[y] as number);

  const link = (x: number, y: number) => {
    src[x] = y;
    dst[y] = x;
  };
  // Isomorphic subtrees have the same preorder shape, so their descendants pair up by offset.
  const linkSubtree = (x: number, y: number) => {
    for (let k = 0, size = sizeA[x] as number; k < size; k++) {
      src[x + k] = y + k;
      dst[y + k] = x + k;
    }
  };
  let diceWork = 0;
  /** Scores 0 when either is -1, a missing parent. */
  const dice = (x: number, y: number): number => {
    if (x < 0 || y < 0) return 0;
    const xs = sizeA[x] as number;
    const ys = sizeB[y] as number;
    if (xs + ys <= 2) return 0;
    diceWork += xs;
    if (diceWork > maxDiceWork) throw new MatchBudgetExceeded();
    let common = 0;
    // An indexed loop: iterating a subarray view here is several times slower, and this is the hot path.
    for (let i = x + 1; i < x + xs; i++) {
      const p = src[i] as number;
      if (p > y && p < y + ys) common++;
    }
    return (2 * common) / (xs + ys - 2);
  };

  // Top-down.
  const qa = new HeightQueue(a);
  const qb = new HeightQueue(b);
  qa.push(0);
  qb.push(0);
  const ambiguous: [number, number][] = [];
  for (;;) {
    const ha = qa.peekMax();
    const hb = qb.peekMax();
    if (Math.min(ha, hb) < opts.minHeight) break;
    if (ha !== hb) {
      const q = ha > hb ? qa : qb;
      for (const n of q.pop()) q.open(n);
      continue;
    }
    const groups = new Map<number, { xs: number[]; ys: number[] }>();
    const group = (isoId: number) => {
      let g = groups.get(isoId);
      if (!g) {
        g = { xs: [], ys: [] };
        groups.set(isoId, g);
      }
      return g;
    };
    for (const x of qa.pop()) group(isoA[x] as number).xs.push(x);
    for (const y of qb.pop()) group(isoB[y] as number).ys.push(y);
    for (const { xs, ys } of groups.values()) {
      const [x] = xs;
      const [y] = ys;
      if (
        x !== undefined &&
        y !== undefined &&
        xs.length === 1 &&
        ys.length === 1
      )
        linkSubtree(x, y);
      else if (xs.length * ys.length > maxAmbiguousPairs) {
        // Too many identical copies to rank pairwise (e.g. thousands of `i++`); pair them in document order.
        for (const [k, x] of xs.entries()) {
          const y = ys[k];
          if (y !== undefined) linkSubtree(x, y);
        }
      } else if (xs.length > 0 && ys.length > 0)
        for (const x of xs) for (const y of ys) ambiguous.push([x, y]);
      else {
        for (const x of xs) qa.open(x);
        for (const y of ys) qb.open(y);
      }
    }
  }

  // Several identical copies. Copies under one parent pair keep their order: an LCS over the parents'
  // children pairs them, so deleting one of `a(); a(); b(); a();` deletes that copy instead of moving
  // another across `b()`. Pairs still left (across parents) prefer parents that already agree, then
  // the closest sibling position.
  const byParents = new Map<number, Map<number, Map<number, Set<number>>>>();
  const entry = <K, V>(m: Map<K, V>, k: K, make: () => V): V => {
    let v = m.get(k);
    if (v === undefined) {
      v = make();
      m.set(k, v);
    }
    return v;
  };
  for (const [x, y] of ambiguous) {
    const px = a.parentOf(x);
    const py = b.parentOf(y);
    if (px === -1 || py === -1) continue;
    const forX = entry(byParents, px, () => new Map());
    const candidates = entry(forX, py, () => new Map());
    entry(candidates, x, () => new Set()).add(y);
  }
  const parentPairs = [...byParents].flatMap(([px, forX]) =>
    [...forX].map(([py, candidates]) => ({
      px,
      py,
      candidates,
      d: dice(px, py),
    })),
  );
  for (const { px, py, candidates } of parentPairs.sort((p, q) => q.d - p.d)) {
    const pairs = commonPairs(a.childrenOf(px), b.childrenOf(py), (p, q) =>
      src[p] !== -1 || dst[q] !== -1
        ? src[p] === q
        : (candidates.get(p)?.has(q) ?? false),
    );
    for (const [p, q] of pairs) if (src[p] === -1) linkSubtree(p, q);
  }
  const siblingIndex = (side: Side, n: number) => {
    const p = side.parentOf(n);
    return p === -1 ? 0 : side.childrenOf(p).indexOf(n);
  };
  ambiguous
    .filter(([x, y]) => src[x] === -1 && dst[y] === -1)
    .map(([x, y]) => ({
      x,
      y,
      d: dice(a.parentOf(x), b.parentOf(y)),
      gap: Math.abs(siblingIndex(a, x) - siblingIndex(b, y)),
    }))
    .sort((p, q) => q.d - p.d || p.gap - q.gap)
    .forEach(({ x, y }) => {
      if (src[x] === -1 && dst[y] === -1) linkSubtree(x, y);
    });

  // Recovery inside a newly matched container pair: pair up its still-unmatched children, then theirs.
  // A worklist instead of recursion, so deep nesting cannot overflow the JS stack; the order is free
  // because recovering one pair only links nodes inside that pair's own subtrees.
  const recover = (root: number, rootB: number) => {
    const pending: [number, number][] = [[root, rootB]];
    const linkAndRecover = (p: number, q: number) => {
      link(p, q);
      pending.push([p, q]);
    };
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [x, y] = next;
      const kidsX = a.childrenOf(x);
      const kidsY = b.childrenOf(y);
      // Already-matched children stay in the sequences as anchors equal only to their partner,
      // so a repeated token (a comma) cannot pair across them and show an inserted sibling's neighbours as moved.
      const unmatchedPairs = (eq: (p: number, q: number) => boolean) =>
        commonPairs(kidsX, kidsY, (p, q) =>
          src[p] !== -1 || dst[q] !== -1 ? src[p] === q : eq(p, q),
        ).filter(([p]) => src[p] === -1);
      for (const [p, q] of unmatchedPairs((p, q) => isoA[p] === isoB[q]))
        linkSubtree(p, q);
      for (const [p, q] of unmatchedPairs(
        (p, q) =>
          kindA(p) === kindB(q) &&
          ta.label(a.nodes[p] as number) === tb.label(b.nodes[q] as number),
      ))
        linkAndRecover(p, q);
      // Kinds that occur once on each side pair up even when labels differ; this is how a changed literal becomes an update.
      const once = (ns: number[], kind: (n: number) => string) => {
        const byKind = new Map<string, number>();
        for (const n of ns) {
          const k = kind(n);
          byKind.set(k, byKind.has(k) ? -1 : n);
        }
        return byKind;
      };
      const onceB = once(
        kidsY.filter((c) => dst[c] === -1),
        kindB,
      );
      for (const [kind, p] of once(
        kidsX.filter((c) => src[c] === -1),
        kindA,
      )) {
        const q = onceB.get(kind);
        if (p !== -1 && q !== undefined && q !== -1) linkAndRecover(p, q);
      }
      // A literal token's kind is its text, so `<` and `<=` never share one; filling the same role in the
      // same place (the `operator` of one binary expression) makes them one token that changed.
      for (const [p, q] of unmatchedPairs((p, q) => {
        const hp = a.nodes[p] as number;
        const hq = b.nodes[q] as number;
        if (ta.named(hp) || tb.named(hq) || sizeA[p] !== 1 || sizeB[q] !== 1)
          return false;
        const field = ta.fieldName(hp);
        return field !== undefined && field === tb.fieldName(hq);
      }))
        link(p, q);
    }
  };

  // Bottom-up, visiting descendants before ancestors (reverse preorder).
  for (let x = sizeA.length - 1; x >= 0; x--) {
    if (src[x] !== -1 || sizeA[x] === 1) continue;
    if (x === 0) {
      if (dst[0] === -1 && kindB(0) === kindA(0)) {
        link(0, 0);
        recover(0, 0);
      }
      continue;
    }
    // Candidates: unmatched same-kind ancestors of where x's descendants went.
    const seen = new Set<number>();
    const kind = kindA(x);
    let best = -1;
    let bestDice = opts.minDice;
    for (let d = x + 1; d < x + (sizeA[x] as number); d++) {
      const p = src[d] as number;
      if (p === -1) continue;
      for (let y = b.parentOf(p); y !== -1 && !seen.has(y); y = b.parentOf(y)) {
        seen.add(y);
        if (dst[y] !== -1 || kindB(y) !== kind) continue;
        const s = dice(x, y);
        if (s > bestDice) {
          best = y;
          bestDice = s;
        }
      }
    }
    if (best !== -1) {
      link(x, best);
      recover(x, best);
    }
  }

  return { a, b, src, dst };
}

/**
 * Equal ids iff the subtrees are isomorphic: same kinds, same token labels, same shape. Exact, no hash collisions.
 * Sides numbered through one shared `intern` compare across files. Indexed like the side.
 */
export function isoIds(side: Side, intern: Map<string, number>): Int32Array {
  const { tree, nodes } = side;
  const ids = new Int32Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i] as number;
    const kids = side.childrenOf(i).map((c) => ids[c]);
    const key = `${tree.kindName(n)}\0${tree.label(n)}\0${kids.join(",")}`;
    let id = intern.get(key);
    if (id === undefined) {
      id = intern.size;
      intern.set(key, id);
    }
    ids[i] = id;
  }
  return ids;
}

/** Side indices bucketed by height. */
class HeightQueue {
  private buckets: number[][] = [];
  private max = 0;
  constructor(private readonly side: Side) {}
  push(n: number) {
    const h = this.side.height[n] as number;
    const bucket = this.buckets[h];
    if (bucket) bucket.push(n);
    else this.buckets[h] = [n];
    this.max = Math.max(this.max, h);
  }
  open(n: number) {
    for (const c of this.side.childrenOf(n)) this.push(c);
  }
  peekMax(): number {
    while (this.max > 0 && !this.buckets[this.max]?.length) this.max--;
    return this.max;
  }
  pop(): number[] {
    const h = this.peekMax();
    const nodes = this.buckets[h] ?? [];
    this.buckets[h] = [];
    return nodes;
  }
}
