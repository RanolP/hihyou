import type { SyntaxNode, SyntaxTree } from "../core/tree.js";
import { commonPairs } from "./sequence.js";

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

/** A one-to-one node mapping between old tree `a` and new tree `b`, by preorder id; -1 means unmatched. */
export interface Mapping {
  a: SyntaxTree;
  b: SyntaxTree;
  src: Int32Array;
  dst: Int32Array;
}

/** `ids[n.id]` for a per-node table such as `Mapping.src`, throwing when `n` is not from the tree it was sized for. */
export function idOf(ids: Int32Array, n: SyntaxNode): number {
  const id = ids[n.id];
  if (id === undefined)
    throw new RangeError(`node ${n.id} is outside a ${ids.length}-node table`);
  return id;
}

/** GumTree (Falleri et al. 2014): greedy top-down isomorphic subtrees, then bottom-up container matching with recovery. */
export function match(
  a: SyntaxTree,
  b: SyntaxTree,
  opts: MatchOptions = defaultMatchOptions,
): Mapping {
  const intern = new Map<string, number>();
  const isoA = isoIds(a, intern);
  const isoB = isoIds(b, intern);
  const src = new Int32Array(a.nodes.length).fill(-1);
  const dst = new Int32Array(b.nodes.length).fill(-1);

  const link = (x: SyntaxNode, y: SyntaxNode) => {
    src[x.id] = y.id;
    dst[y.id] = x.id;
  };
  // Isomorphic subtrees have the same preorder shape, so their descendants pair up by offset.
  const linkSubtree = (x: SyntaxNode, y: SyntaxNode) => {
    for (let k = 0; k < x.size; k++) {
      src[x.id + k] = y.id + k;
      dst[y.id + k] = x.id + k;
    }
  };
  let diceWork = 0;
  const dice = (
    x: SyntaxNode | undefined,
    y: SyntaxNode | undefined,
  ): number => {
    if (!x || !y || x.size + y.size <= 2) return 0;
    diceWork += x.size;
    if (diceWork > maxDiceWork) throw new MatchBudgetExceeded();
    let common = 0;
    // An indexed loop: iterating a subarray view here is several times slower, and this is the hot path.
    for (let i = x.id + 1; i < x.id + x.size; i++) {
      const p = src[i];
      if (p !== undefined && p > y.id && p < y.id + y.size) common++;
    }
    return (2 * common) / (x.size + y.size - 2);
  };

  // Top-down.
  const qa = new HeightQueue();
  const qb = new HeightQueue();
  qa.push(a.node(0));
  qb.push(b.node(0));
  const ambiguous: [SyntaxNode, SyntaxNode][] = [];
  for (;;) {
    const ha = qa.peekMax();
    const hb = qb.peekMax();
    if (Math.min(ha, hb) < opts.minHeight) break;
    if (ha !== hb) {
      const q = ha > hb ? qa : qb;
      for (const n of q.pop()) q.open(n);
      continue;
    }
    const groups = new Map<number, { xs: SyntaxNode[]; ys: SyntaxNode[] }>();
    const group = (isoId: number) => {
      let g = groups.get(isoId);
      if (!g) {
        g = { xs: [], ys: [] };
        groups.set(isoId, g);
      }
      return g;
    };
    for (const x of qa.pop()) group(idOf(isoA, x)).xs.push(x);
    for (const y of qb.pop()) group(idOf(isoB, y)).ys.push(y);
    for (const { xs, ys } of groups.values()) {
      const [x] = xs;
      const [y] = ys;
      if (x && y && xs.length === 1 && ys.length === 1) linkSubtree(x, y);
      else if (xs.length * ys.length > maxAmbiguousPairs) {
        // Too many identical copies to rank pairwise (e.g. thousands of `i++`); pair them in document order.
        for (const [k, x] of xs.entries()) {
          const y = ys[k];
          if (y) linkSubtree(x, y);
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
  const byParents = new Map<
    SyntaxNode,
    Map<SyntaxNode, Map<SyntaxNode, Set<SyntaxNode>>>
  >();
  const entry = <K, V>(m: Map<K, V>, k: K, make: () => V): V => {
    let v = m.get(k);
    if (v === undefined) {
      v = make();
      m.set(k, v);
    }
    return v;
  };
  for (const [x, y] of ambiguous) {
    if (!x.parent || !y.parent) continue;
    const forX = entry(byParents, x.parent, () => new Map());
    const candidates = entry(forX, y.parent, () => new Map());
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
    const pairs = commonPairs(px.children, py.children, (p, q) =>
      src[p.id] !== -1 || dst[q.id] !== -1
        ? src[p.id] === q.id
        : (candidates.get(p)?.has(q) ?? false),
    );
    for (const [p, q] of pairs) if (src[p.id] === -1) linkSubtree(p, q);
  }
  const siblingIndex = (n: SyntaxNode) => n.parent?.children.indexOf(n) ?? 0;
  ambiguous
    .filter(([x, y]) => src[x.id] === -1 && dst[y.id] === -1)
    .map(([x, y]) => ({
      x,
      y,
      d: dice(x.parent, y.parent),
      gap: Math.abs(siblingIndex(x) - siblingIndex(y)),
    }))
    .sort((p, q) => q.d - p.d || p.gap - q.gap)
    .forEach(({ x, y }) => {
      if (src[x.id] === -1 && dst[y.id] === -1) linkSubtree(x, y);
    });

  // Recovery inside a newly matched container pair: pair up its still-unmatched children, then theirs.
  // A worklist instead of recursion, so deep nesting cannot overflow the JS stack; the order is free
  // because recovering one pair only links nodes inside that pair's own subtrees.
  const recover = (root: SyntaxNode, rootB: SyntaxNode) => {
    const pending: [SyntaxNode, SyntaxNode][] = [[root, rootB]];
    const linkAndRecover = (p: SyntaxNode, q: SyntaxNode) => {
      link(p, q);
      pending.push([p, q]);
    };
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [x, y] = next;
      // Already-matched children stay in the sequences as anchors equal only to their partner,
      // so a repeated token (a comma) cannot pair across them and show an inserted sibling's neighbours as moved.
      const unmatchedPairs = (eq: (p: SyntaxNode, q: SyntaxNode) => boolean) =>
        commonPairs(x.children, y.children, (p, q) =>
          src[p.id] !== -1 || dst[q.id] !== -1 ? src[p.id] === q.id : eq(p, q),
        ).filter(([p]) => src[p.id] === -1);
      for (const [p, q] of unmatchedPairs(
        (p, q) => idOf(isoA, p) === idOf(isoB, q),
      ))
        linkSubtree(p, q);
      for (const [p, q] of unmatchedPairs(
        (p, q) => p.kind === q.kind && p.label === q.label,
      ))
        linkAndRecover(p, q);
      // Kinds that occur once on each side pair up even when labels differ; this is how a changed literal becomes an update.
      const xs = x.children.filter((c) => src[c.id] === -1);
      const ys = y.children.filter((c) => dst[c.id] === -1);
      const once = <T extends SyntaxNode>(ns: T[]) => {
        const byKind = new Map<string, T | null>();
        for (const n of ns) byKind.set(n.kind, byKind.has(n.kind) ? null : n);
        return byKind;
      };
      const onceB = once(ys);
      for (const [kind, p] of once(xs)) {
        const q = onceB.get(kind);
        if (p && q) linkAndRecover(p, q);
      }
      // A literal token's kind is its text, so `<` and `<=` never share one; filling the same role in the
      // same place (the `operator` of one binary expression) makes them one token that changed.
      for (const [p, q] of unmatchedPairs(
        (p, q) =>
          !p.named &&
          !q.named &&
          p.children.length === 0 &&
          q.children.length === 0 &&
          p.field !== undefined &&
          p.field === q.field,
      ))
        link(p, q);
    }
  };

  // Bottom-up, visiting descendants before ancestors (reverse preorder).
  for (const x of a.nodes.toReversed()) {
    if (src[x.id] !== -1 || x.children.length === 0) continue;
    if (!x.parent) {
      const root = b.node(0);
      if (dst[0] === -1 && root.kind === x.kind) {
        link(x, root);
        recover(x, root);
      }
      continue;
    }
    // Candidates: unmatched same-kind ancestors of where x's descendants went.
    const seen = new Set<number>();
    let best: SyntaxNode | undefined;
    let bestDice = opts.minDice;
    for (let d = x.id + 1; d < x.id + x.size; d++) {
      const p = src[d];
      if (p === undefined || p === -1) continue;
      for (let y = b.node(p).parent; y && !seen.has(y.id); y = y.parent) {
        seen.add(y.id);
        if (y.kind !== x.kind || dst[y.id] !== -1) continue;
        const s = dice(x, y);
        if (s > bestDice) {
          best = y;
          bestDice = s;
        }
      }
    }
    if (best) {
      link(x, best);
      recover(x, best);
    }
  }

  return { a, b, src, dst };
}

/**
 * Equal ids iff the subtrees are isomorphic: same kinds, same token labels, same shape. Exact, no hash collisions.
 * Trees numbered through one shared `intern` compare across files.
 */
export function isoIds(
  tree: SyntaxTree,
  intern: Map<string, number>,
): Int32Array {
  const ids = new Int32Array(tree.nodes.length);
  for (const n of tree.nodes.toReversed()) {
    const key = `${n.kind}\0${n.label}\0${n.children.map((c) => ids[c.id]).join(",")}`;
    let id = intern.get(key);
    if (id === undefined) {
      id = intern.size;
      intern.set(key, id);
    }
    ids[n.id] = id;
  }
  return ids;
}

class HeightQueue {
  private buckets: SyntaxNode[][] = [];
  private max = 0;
  push(n: SyntaxNode) {
    const bucket = this.buckets[n.height];
    if (bucket) bucket.push(n);
    else this.buckets[n.height] = [n];
    this.max = Math.max(this.max, n.height);
  }
  open(n: SyntaxNode) {
    for (const c of n.children) this.push(c);
  }
  peekMax(): number {
    while (this.max > 0 && !this.buckets[this.max]?.length) this.max--;
    return this.max;
  }
  pop(): SyntaxNode[] {
    const h = this.peekMax();
    const nodes = this.buckets[h] ?? [];
    this.buckets[h] = [];
    return nodes;
  }
}
