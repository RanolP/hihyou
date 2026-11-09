import type { Tree } from "../core/arena.js";
import { nameOf } from "./move.js";
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
  /** Undoes one pairing, leaving independently matched descendants where they moved. */
  const unlink = (x: number, y: number) => {
    if (src[x] === y) src[x] = -1;
    if (dst[y] === x) dst[y] = -1;
  };
  /** Undoes every pairing between the subtrees of `x` and `y`. */
  const unlinkWithin = (x: number, y: number) => {
    const end = y + (sizeB[y] as number);
    for (let k = x; k < x + (sizeA[x] as number); k++) {
      const p = src[k] as number;
      if (p < y || p >= end) continue;
      src[k] = -1;
      dst[p] = -1;
    }
  };
  let diceWork = 0;
  /** Descendants of `x` matched to descendants of `y`. */
  const common = (x: number, y: number): number => {
    const xs = sizeA[x] as number;
    const ys = sizeB[y] as number;
    diceWork += xs;
    if (diceWork > maxDiceWork) throw new MatchBudgetExceeded();
    let n = 0;
    // An indexed loop: iterating a subarray view here is several times slower, and this is the hot path.
    for (let i = x + 1; i < x + xs; i++) {
      const p = src[i] as number;
      if (p > y && p < y + ys) n++;
    }
    return n;
  };
  /** Scores 0 when either is -1, a missing parent. */
  const dice = (x: number, y: number): number => {
    if (x < 0 || y < 0) return 0;
    const xs = sizeA[x] as number;
    const ys = sizeB[y] as number;
    if (xs + ys <= 2) return 0;
    return (2 * common(x, y)) / (xs + ys - 2);
  };

  // Top-down.
  const qa = new HeightQueue(a);
  const qb = new HeightQueue(b);
  qa.push(0);
  qb.push(0);
  const ambiguous: [number, number][] = [];
  let neighboursA: [Int32Array, Int32Array] | undefined;
  let neighboursB: [Int32Array, Int32Array] | undefined;
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
        // Too many identical copies to rank pairwise (e.g. thousands of `i++`). Plain document order would pair
        // every copy after an inserted one with its predecessor (tokio's blank `///` doc lines), so pair along a
        // common subsequence of copies whose neighbours also agree, then the rest in order between those anchors.
        neighboursA ??= neighbours(a);
        neighboursB ??= neighbours(b);
        const [prevA, nextA] = neighboursA;
        const [prevB, nextB] = neighboursB;
        const iso = (ids: Int32Array | number[], n: number) => (n === -1 ? -1 : (ids[n] as number));
        const anchors = commonPairs(
          [...xs.keys()],
          [...ys.keys()],
          (i, j) => {
            const x = xs[i] as number;
            const y = ys[j] as number;
            return (
              iso(isoA, prevA[x] as number) === iso(isoB, prevB[y] as number) &&
              iso(isoA, nextA[x] as number) === iso(isoB, nextB[y] as number)
            );
          },
        );
        let i = 0;
        let j = 0;
        for (const [iEnd, jEnd] of [...anchors, [xs.length, ys.length]]) {
          for (; i < (iEnd as number) && j < (jEnd as number); i++, j++)
            linkSubtree(xs[i] as number, ys[j] as number);
          const x = xs[iEnd as number];
          const y = ys[jEnd as number];
          if (x !== undefined && y !== undefined) linkSubtree(x, y);
          i = (iEnd as number) + 1;
          j = (jEnd as number) + 1;
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
  // Parents that tie, often with nothing of either matched yet, go by how near their ancestors share matched
  // nodes: of three `instance: z.string().min(1)` that each gained `.optional()`, each copy pairs with the one in
  // its own object, not the next in document order. An ancestor is compared with the nearest one of its kind
  // across, climbing either side, as the copy may sit deeper on one of them.
  const sharedAt = new Map<number, boolean>();
  const shares = (x: number, y: number) => {
    const key = x * sizeB.length + y;
    let shared = sharedAt.get(key);
    if (shared === undefined) {
      shared = common(x, y) > 0;
      sharedAt.set(key, shared);
    }
    return shared;
  };
  const climb = (
    side: Side,
    other: Side,
    x: number,
    y: number,
    test: (x: number, y: number) => boolean,
  ): number => {
    let steps = 0;
    for (
      let ax = side.parentOf(x), by = other.parentOf(y);
      ax !== -1 && by !== -1;
      ax = side.parentOf(ax), steps++
    ) {
      const kind = side.tree.kindName(side.nodes[ax] as number);
      let up = by;
      while (
        up !== -1 &&
        other.tree.kindName(other.nodes[up] as number) !== kind
      )
        up = other.parentOf(up);
      if (up === -1) continue;
      by = other.parentOf(up);
      if (test(ax, up)) return steps;
    }
    return sizeA.length;
  };
  const kinship = (x: number, y: number) =>
    Math.min(
      climb(a, b, x, y, shares),
      climb(b, a, y, x, (q, p) => shares(p, q)),
    );
  const parentPairs = [...byParents].flatMap(([px, forX]) =>
    [...forX].map(([py, candidates]) => ({
      px,
      py,
      candidates,
      d: dice(px, py),
      k: kinship(px, py),
    })),
  );
  for (const { px, py, candidates } of parentPairs.sort(
    (p, q) => q.d - p.d || p.k - q.k,
  )) {
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
      k: kinship(a.parentOf(x), b.parentOf(y)),
      gap: Math.abs(siblingIndex(a, x) - siblingIndex(b, y)),
    }))
    .sort((p, q) => q.d - p.d || p.k - q.k || p.gap - q.gap)
    .forEach(({ x, y }) => {
      if (src[x] === -1 && dst[y] === -1) linkSubtree(x, y);
    });
  // Pairs made by shape alone, before any ancestor was matched; checked against their ancestors at the end.
  const topDown = src.slice();

  // Recovery inside a newly matched container pair: pair up its still-unmatched children, then theirs.
  // A worklist instead of recursion, so deep nesting cannot overflow the JS stack; the order is free
  // because recovering one pair only links nodes inside that pair's own subtrees.
  const nameKey = (side: Side, n: number) => {
    const h = side.nodes[n] as number;
    const name = memberName(side.tree, h);
    return name === undefined ? undefined : `${side.tree.kindName(h)}\0${name}`;
  };
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
      // A member is its name within its scope: a kind and name found once on each side, among the children not
      // already paired with their namesake inside this pair, is one member edited in place. It pairs before any pass
      // that goes by shape, so shape decides only among the rest and a rename still pairs; a declaration moved past
      // its siblings with a token changed in most statements, which keeps no subtree whole to seed the bottom-up
      // phase, pairs here too. A member the bottom-up phase gave to a look-alike, in another scope (an object's
      // `sleep` whose signature reappears in a new function's object) or under another name in this one (a function
      // whose old body moved into a new sibling), comes back; an identical copy there keeps it, as a move.
      const byName = (
        side: Side,
        ns: number[],
        partner: Int32Array,
        other: Side,
        otherParent: number,
      ) => {
        const found = new Map<string, number>();
        for (const n of ns) {
          const key = nameKey(side, n);
          if (key === undefined) continue;
          const m = partner[n] as number;
          if (
            m !== -1 &&
            other.parentOf(m) === otherParent &&
            nameKey(other, m) === key
          )
            continue;
          found.set(key, found.has(key) ? -1 : n);
        }
        return found;
      };
      const namedB = byName(b, kidsY, dst, a, x);
      for (const [key, p] of byName(a, kidsX, src, b, y)) {
        const q = namedB.get(key);
        if (p === -1 || q === undefined || q === -1) continue;
        const elsewhereA = src[p] as number;
        const elsewhereB = dst[q] as number;
        if (elsewhereA !== -1 && isoA[p] === isoB[elsewhereA]) continue;
        if (elsewhereB !== -1 && isoA[elsewhereB] === isoB[q]) continue;
        if (elsewhereA !== -1)
          (b.parentOf(elsewhereA) === y ? unlink : unlinkWithin)(p, elsewhereA);
        if (elsewhereB !== -1)
          (a.parentOf(elsewhereB) === x ? unlink : unlinkWithin)(elsewhereB, q);
        linkAndRecover(p, q);
      }
      // A child whose matched descendants went mostly into another unmatched child across belongs with that
      // one, not with the first look-alike in order: when a new `useEffect(...)` lands above an edited one, the
      // old effect pairs with the edited one, which holds its body, rather than with the new one.
      const fitsA = homes(src, sizeA, kidsY, dst, sizeB);
      const fitsB = homes(dst, sizeB, kidsX, src, sizeA);
      const fits = (p: number, q: number) => fitsA(p, q) && fitsB(q, p);
      for (const [p, q] of unmatchedPairs(
        (p, q) =>
          kindA(p) === kindB(q) &&
          ta.label(a.nodes[p] as number) === tb.label(b.nodes[q] as number) &&
          fits(p, q),
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
        if (p !== -1 && q !== undefined && q !== -1 && fits(p, q))
          linkAndRecover(p, q);
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
      // A child wrapped in place (`16` becoming `s(16)`) or unwrapped: the old child reappears inside the new one
      // that fills its role. Pair it with that copy so only the wrapper reads as added; with two copies inside,
      // which one it became is a guess, so both stay unmatched.
      const inside = (
        side: Side,
        iso: Int32Array,
        partner: Int32Array,
        root: number,
        id: number,
      ): number => {
        let found = -1;
        for (let r = root + 1; r < root + (side.size[root] as number); r++) {
          if (partner[r] !== -1 || iso[r] !== id) continue;
          if (found !== -1) return -1;
          found = r;
        }
        return found;
      };
      // A token beside the child goes with its copy beside the node it became, when only position paired it with
      // the token beside the wrapper: `this.#ctx.storage.list<T>(…)` becoming `this.#s()` keeps the `.` after
      // `this`, not the one before `list`. One whose sibling past it is paired too (`a.b` becoming `a.c.b`) stays.
      const besides = (
        unwrap: boolean,
        wrapper: number,
        deep: number,
        plain: number,
      ) => {
        const [ds, ps] = unwrap ? [a, b] : [b, a];
        const [dp, pp] = unwrap ? [src, dst] : [dst, src];
        const [di, pi] = unwrap ? [isoA, isoB] : [isoB, isoA];
        for (const step of [-1, 1]) {
          const t = sibling(ps, plain, step);
          const s = sibling(ds, wrapper, step);
          const n = sibling(ds, deep, step);
          if (t === -1 || s === -1 || n === -1 || ps.size[t] !== 1) continue;
          if (pp[t] !== s || dp[n] !== -1 || di[n] !== pi[t]) continue;
          const past = sibling(ps, t, step);
          if (
            past !== -1 &&
            pp[past] !== -1 &&
            pp[past] === sibling(ds, s, step)
          )
            continue;
          dp[s] = -1;
          pp[t] = n;
          dp[n] = t;
        }
      };
      for (const [p, q] of unmatchedPairs(
        (p, q) =>
          ta.fieldName(a.nodes[p] as number) ===
          tb.fieldName(b.nodes[q] as number),
      )) {
        const wrapped = inside(b, isoB, dst, q, isoA[p] as number);
        const unwrapped = inside(a, isoA, src, p, isoB[q] as number);
        if (wrapped !== -1 && unwrapped === -1) {
          linkSubtree(p, wrapped);
          besides(false, q, wrapped, p);
        } else if (unwrapped !== -1 && wrapped === -1) {
          linkSubtree(unwrapped, q);
          besides(true, p, unwrapped, q);
        }
      }
    }
  };

  // Candidates: unmatched same-kind ancestors of where x's descendants went, except `skip`. The one holding
  // most of x's children wins, and dice only breaks ties: a block whose loop was extracted into a new function
  // shares more nodes with that function's body, yet pairing it there moves the block and every statement left behind.
  const bestFor = (x: number, skip: number): number => {
    const seen = new Set<number>([skip]);
    const kind = kindA(x);
    const kids = a.childrenOf(x);
    const held = (y: number) =>
      kids.filter((c) => {
        const p = src[c] as number;
        return p > y && p < y + (sizeB[y] as number);
      }).length;
    let best = -1;
    let bestHeld = -1;
    let bestDice = opts.minDice;
    for (let d = x + 1; d < x + (sizeA[x] as number); d++) {
      const p = src[d] as number;
      if (p === -1) continue;
      for (let y = b.parentOf(p); y !== -1 && !seen.has(y); y = b.parentOf(y)) {
        seen.add(y);
        if (dst[y] !== -1 || kindB(y) !== kind) continue;
        const s = dice(x, y);
        if (s <= opts.minDice) continue;
        const h = held(y);
        if (h > bestHeld || (h === bestHeld && s > bestDice)) {
          best = y;
          bestHeld = h;
          bestDice = s;
        }
      }
    }
    return best;
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
    // A deleted wrapper is visited before the node it wrapped (`<P>{() => <>kids</>}</P>` becoming
    // `<T>kids</T>`): the inner `<>` holds as many of `<T>`'s children as `<P>` does, but `<P>` also holds
    // `<T>`'s attributes. Leave the candidate to the nearest same-kind ancestor when that ancestor would pick it
    // too and holds strictly more of it, or `<P>` is left unmatched and `<T>` reads as moved.
    let up = a.parentOf(x);
    while (up !== -1 && kindA(up) !== kindA(x)) up = a.parentOf(up);
    let best = bestFor(x, -1);
    if (
      best !== -1 &&
      up !== -1 &&
      src[up] === -1 &&
      common(up, best) > common(x, best) &&
      bestFor(up, -1) === best
    )
      best = bestFor(x, best);
    if (best !== -1) {
      link(x, best);
      recover(x, best);
    }
  }

  // A subtree the top-down phase paired by shape alone can land in unrelated new code: an edited
  // `if (c)` whose old `(c)` also appears in a new `else if (c)` elsewhere. Once its parent is matched and the
  // parent's partner fills the same one-node role (`condition`) with an unmatched node, that pairing crosses
  // unrelated parents. Undo it, keep only the parts that reappear inside that role, and let recovery pair the
  // rest in place. A list member (a statement) has no such role: one that moved out of a matched block is a move.
  const role = (side: Side, n: number, field: string) => {
    const tree = side.tree;
    const holders = side
      .childrenOf(n)
      .filter((c) => tree.fieldName(side.nodes[c] as number) === field);
    return holders.length === 1 ? (holders[0] as number) : -1;
  };
  for (let x = 1; x < sizeA.length; x++) {
    const y = src[x] as number;
    const px = a.parentOf(x);
    const py = src[px] as number;
    if (y === -1 || py === -1 || topDown[x] !== y || topDown[px] !== -1)
      continue;
    // Under the parent's partner already, if only wrapped deeper (`(c)` becoming `(c && d)`), it stays.
    if (y > py && y < py + (sizeB[py] as number)) continue;
    if (dst[b.parentOf(y)] !== -1) continue;
    const field = ta.fieldName(a.nodes[x] as number);
    if (field === undefined || role(a, px, field) !== x) continue;
    const slot = role(b, py, field);
    if (slot === -1 || dst[slot] !== -1 || kindB(slot) !== kindA(x)) continue;
    const end = x + (sizeA[x] as number);
    for (let k = x; k < end; k++) {
      dst[src[k] as number] = -1;
      src[k] = -1;
    }
    const inSlot = new Map<number, number[]>();
    for (let q = slot; q < slot + (sizeB[slot] as number); q++)
      if (dst[q] === -1 && (sizeB[q] as number) > 1)
        entry(inSlot, isoB[q] as number, () => []).push(q);
    for (let k = x; k < end; k++) {
      const only = inSlot.get(isoA[k] as number);
      if (only?.length !== 1 || dst[only[0] as number] !== -1) continue;
      linkSubtree(k, only[0] as number);
      k += (sizeA[k] as number) - 1;
    }
    recover(px, py);
    x = end - 1;
  }

  // A comment whose own parent went unmatched (a block body becoming an expression body) has no container pair
  // for recovery to find it in, so it read as removed and re-added. Under the nearest matched ancestor pair, a
  // comment whose text occurs exactly once on each side is the same comment; any repeat leaves both unmatched.
  const comments = (side: Side, partner: Int32Array) => {
    const byText = new Map<string, number[]>();
    for (let n = 0; n < side.size.length; n++) {
      const h = side.nodes[n] as number;
      if (side.size[n] === 1 && /comment/.test(side.tree.kindName(h)))
        entry(byText, side.tree.text(h), () => []).push(n);
    }
    const within = (text: string, root: number) =>
      (byText.get(text) ?? []).filter(
        (n) => n > root && n < root + (side.size[root] as number),
      );
    const anchor = (n: number) => {
      let p = side.parentOf(n);
      while (p !== -1 && partner[p] === -1) p = side.parentOf(p);
      return p;
    };
    return { byText, within, anchor };
  };
  const ca = comments(a, src);
  const cb = comments(b, dst);
  for (const [text, xs] of ca.byText)
    for (const x of xs) {
      if (src[x] !== -1) continue;
      const up = ca.anchor(x);
      const upB = up === -1 ? -1 : (src[up] as number);
      if (upB === -1 || ca.within(text, up).length !== 1) continue;
      const ys = cb.within(text, upB);
      const y = ys[0];
      if (ys.length !== 1 || y === undefined || dst[y] !== -1) continue;
      if (cb.anchor(y) === upB) link(x, y);
    }

  // A changed multi-line leaf has no identical subtree to seed matching. Pair it when it is the only leaf of
  // its kind in the same gap between already-matched siblings; the line differ can then keep its unchanged lines.
  for (let x = 0; x < a.size.length; x++) {
    const y = src[x] as number;
    if (y === -1) continue;
    const kidsA = a.childrenOf(x);
    const kidsB = b.childrenOf(y);
    const gaps = (
      side: Side,
      kids: number[],
      partner: Int32Array,
      forward: boolean,
    ) => {
      const out = new Map<string, number[]>();
      const anchor = (n: number) => {
        const p = partner[n] as number;
        return p === -1 ? undefined : forward ? `${n}:${p}` : `${p}:${n}`;
      };
      const next = Array.from<string | undefined>({ length: kids.length });
      let right: string | undefined;
      for (let i = kids.length - 1; i >= 0; i--) {
        right = anchor(kids[i] as number) ?? right;
        next[i] = right;
      }
      let left: string | undefined;
      for (const [i, n] of kids.entries()) {
        const own = anchor(n);
        if (own !== undefined) {
          left = own;
          continue;
        }
        if (sideLeafLineCount(side, n) < 2) continue;
        const h = side.nodes[n] as number;
        const key = `${left ?? "^"}\0${next[i] ?? "$"}\0${side.tree.kindName(h)}`;
        entry(out, key, () => []).push(n);
      }
      return out;
    };
    const gapsA = gaps(a, kidsA, src, true);
    const gapsB = gaps(b, kidsB, dst, false);
    for (const [key, xs] of gapsA) {
      const ys = gapsB.get(key);
      const p = xs[0];
      const q = ys?.[0];
      if (
        xs.length === 1 &&
        ys?.length === 1 &&
        p !== undefined &&
        q !== undefined
      )
        link(p, q);
    }
  }

  return { a, b, src, dst };
}

/** The sibling `step` places after `n` (before it when negative); -1 past either end or at the root. */
function sibling(side: Side, n: number, step: number): number {
  const p = side.parentOf(n);
  if (p === -1) return -1;
  const kids = side.childrenOf(p);
  return kids[kids.indexOf(n) + step] ?? -1;
}

function sideLeafLineCount(side: Side, n: number): number {
  if (side.size[n] !== 1) return 0;
  const text = side.tree.text(side.nodes[n] as number);
  let count = 1;
  for (
    let i = text.indexOf("\n");
    i !== -1;
    i = text.indexOf("\n", i + 1)
  )
    count++;
  return count;
}

/** A declaration's name, or the key of a member written `key: value` (an object property, a mapping entry). */
function memberName(tree: Tree, n: number): string | undefined {
  if (!tree.named(n)) return undefined;
  const name = nameOf(tree, n);
  if (name !== undefined) return name;
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.fieldName(c) === "key") return tree.text(c);
  }
  return undefined;
}

/**
 * `fits(p, q)`: no other still-unmatched node of `others` holds more of `p`'s matched descendants than `q` does.
 * `others` is a sibling list in preorder, so a descendant's partner finds the sibling holding it by bisection.
 */
function homes(
  partner: Int32Array,
  size: Uint32Array,
  others: number[],
  back: Int32Array,
  otherSize: Uint32Array,
): (p: number, q: number) => boolean {
  const tally = new Map<number, { held: Map<number, number>; most: number }>();
  const tallyOf = (p: number) => {
    let t = tally.get(p);
    if (t) return t;
    const held = new Map<number, number>();
    let most = 0;
    for (let i = p + 1; i < p + (size[p] as number); i++) {
      const target = partner[i] as number;
      if (target === -1 || others.length === 0) continue;
      let lo = 0;
      let hi = others.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((others[mid] as number) <= target) lo = mid;
        else hi = mid - 1;
      }
      const o = others[lo] as number;
      if (
        o > target ||
        target >= o + (otherSize[o] as number) ||
        back[o] !== -1
      )
        continue;
      const n = (held.get(o) ?? 0) + 1;
      held.set(o, n);
      most = Math.max(most, n);
    }
    t = { held, most };
    tally.set(p, t);
    return t;
  };
  return (p, q) => {
    const { held, most } = tallyOf(p);
    return (held.get(q) ?? 0) >= most;
  };
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

/** Each index's previous and next sibling, -1 at either end of its parent. */
function neighbours(side: Side): [Int32Array, Int32Array] {
  const prev = new Int32Array(side.size.length).fill(-1);
  const next = new Int32Array(side.size.length).fill(-1);
  for (let p = 0; p < side.size.length; p++) {
    const kids = side.childrenOf(p);
    for (let k = 1; k < kids.length; k++) {
      prev[kids[k] as number] = kids[k - 1] as number;
      next[kids[k - 1] as number] = kids[k] as number;
    }
  }
  return [prev, next];
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
