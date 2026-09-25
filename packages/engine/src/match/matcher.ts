import type { SyntaxNode, SyntaxTree } from "../parse/tree.js";
import { commonPairs } from "./sequence.js";

export interface MatchOptions {
  /** Top-down phase ignores subtrees lower than this; single tokens are left to the bottom-up recovery. */
  minHeight: number;
  /** Bottom-up phase pairs two containers when this share of their descendants is already matched. */
  minDice: number;
}

export const defaultMatchOptions: MatchOptions = { minHeight: 2, minDice: 0.5 };

const maxAmbiguousPairs = 10_000;

/** A one-to-one node mapping between old tree `a` and new tree `b`, by preorder id; -1 means unmatched. */
export interface Mapping {
  a: SyntaxTree;
  b: SyntaxTree;
  src: Int32Array;
  dst: Int32Array;
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
  const nodeB = (id: number) => b.nodes[id] as SyntaxNode;

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
  const dice = (
    x: SyntaxNode | undefined,
    y: SyntaxNode | undefined,
  ): number => {
    if (!x || !y || x.size + y.size <= 2) return 0;
    let common = 0;
    for (let i = x.id + 1; i < x.id + x.size; i++) {
      const p = src[i] as number;
      if (p > y.id && p < y.id + y.size) common++;
    }
    return (2 * common) / (x.size + y.size - 2);
  };

  // Top-down.
  const qa = new HeightQueue();
  const qb = new HeightQueue();
  qa.push(a.nodes[0] as SyntaxNode);
  qb.push(b.nodes[0] as SyntaxNode);
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
    const group = (iso: number) => {
      let g = groups.get(iso);
      if (!g) {
        g = { xs: [], ys: [] };
        groups.set(iso, g);
      }
      return g;
    };
    for (const x of qa.pop()) group(isoA[x.id] as number).xs.push(x);
    for (const y of qb.pop()) group(isoB[y.id] as number).ys.push(y);
    for (const { xs, ys } of groups.values()) {
      if (xs.length === 1 && ys.length === 1)
        linkSubtree(xs[0] as SyntaxNode, ys[0] as SyntaxNode);
      else if (xs.length * ys.length > maxAmbiguousPairs) {
        // Too many identical copies to rank pairwise (e.g. thousands of `i++`); pair them in document order.
        for (let k = 0; k < Math.min(xs.length, ys.length); k++)
          linkSubtree(xs[k] as SyntaxNode, ys[k] as SyntaxNode);
      } else if (xs.length > 0 && ys.length > 0)
        for (const x of xs) for (const y of ys) ambiguous.push([x, y]);
      else {
        for (const x of xs) qa.open(x);
        for (const y of ys) qb.open(y);
      }
    }
  }
  // Several identical copies: prefer the pair whose parents already agree, then the closest sibling position.
  const siblingIndex = (n: SyntaxNode) => n.parent?.children.indexOf(n) ?? 0;
  ambiguous
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

  // Recovery inside a newly matched container pair: pair up its still-unmatched children.
  const recover = (x: SyntaxNode, y: SyntaxNode) => {
    // Already-matched children stay in the sequences as anchors equal only to their partner,
    // so a repeated token (a comma) cannot pair across them and show an inserted sibling's neighbours as moved.
    const unmatchedPairs = (eq: (p: SyntaxNode, q: SyntaxNode) => boolean) =>
      commonPairs(x.children, y.children, (p, q) =>
        src[p.id] !== -1 || dst[q.id] !== -1 ? src[p.id] === q.id : eq(p, q),
      ).filter(([p]) => src[p.id] === -1);
    for (const [p, q] of unmatchedPairs((p, q) => isoA[p.id] === isoB[q.id]))
      linkSubtree(p, q);
    for (const [p, q] of unmatchedPairs(
      (p, q) => p.kind === q.kind && p.label === q.label,
    )) {
      link(p, q);
      recover(p, q);
    }
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
      if (p && q) {
        link(p, q);
        recover(p, q);
      }
    }
  };

  // Bottom-up, visiting descendants before ancestors (reverse preorder).
  for (let i = a.nodes.length - 1; i >= 0; i--) {
    const x = a.nodes[i] as SyntaxNode;
    if (src[x.id] !== -1 || x.children.length === 0) continue;
    if (!x.parent) {
      const root = nodeB(0);
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
      const p = src[d] as number;
      if (p === -1) continue;
      for (let y = nodeB(p).parent; y && !seen.has(y.id); y = y.parent) {
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

/** Equal ids iff the subtrees are isomorphic: same kinds, same token labels, same shape. Exact, no hash collisions. */
function isoIds(tree: SyntaxTree, intern: Map<string, number>): Int32Array {
  const ids = new Int32Array(tree.nodes.length);
  for (let i = tree.nodes.length - 1; i >= 0; i--) {
    const n = tree.nodes[i] as SyntaxNode;
    const key = `${n.kind}\0${n.label}\0${n.children.map((c) => ids[c.id]).join(",")}`;
    let id = intern.get(key);
    if (id === undefined) {
      id = intern.size;
      intern.set(key, id);
    }
    ids[i] = id;
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
