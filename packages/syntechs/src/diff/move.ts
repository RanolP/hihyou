import type { Tree } from "../core/arena.js";
import { isContentAtom, isUnit } from "./content.js";
import { isoIds, type Mapping } from "./matcher.js";
import {
  alphaIds,
  type Locals,
  resolveLocals,
  type ScopeRules,
} from "./scope.js";
import type { Side } from "./side.js";

/**
 * What a matched node that changed place is shown as, with the evidence for it (`docs/design/move-theory.md`):
 * `pure` when the two subtrees are equal as written, token for token; `edited` with a unit core, whole units equal
 * up to renamed locals, disjoint and in order, carrying half the content atoms of each side and one unit of `k`
 * atoms or more. A local renamed on the way is a change, so a block equal only up to renames is `edited`.
 */
export type MoveWitness =
  | { kind: "pure" }
  | {
      kind: "edited";
      /** Pairs of side indices, base then head, in document order. */
      core: [number, number][];
      /** Content atoms the core carries over, a renamed occurrence counting nothing. */
      weight: number;
    };

export interface MoveOptions {
  /**
   * `k`: both subtrees need this many content atoms, and an edited move's heaviest core unit too. The
   * content-counted counterpart of git's 20 alphanumeric characters and Phabricator's 3 lines of 30.
   */
  minAtoms: number;
  /** The grammar's scoping rules, so a unit whose locals were renamed still pairs; without them names compare as written. */
  scope?: ScopeRules;
}

export const defaultMoveOptions: MoveOptions = { minAtoms: 4 };

/** What a witness reads of one side: iso ids as written, ids over alpha-normalized locals, content atom counts. */
export interface WitnessSide {
  side: Side;
  iso: Int32Array;
  alpha: Int32Array;
  /** `|C|` of each index's subtree. */
  atoms: Uint32Array;
  locals?: Locals;
}

/** The witness data of `side`, numbered through `intern` so another side built with the same map compares. */
export function witnessSide(
  side: Side,
  intern: Map<string, number>,
  locals?: Locals,
): WitnessSide {
  return {
    side,
    iso: isoIds(side, intern),
    alpha: alphaIds(side, locals, intern),
    atoms: atomCounts(side),
    ...(locals && { locals }),
  };
}

/** `|C|` of each index's subtree of `side`. */
export function atomCounts(side: Side): Uint32Array {
  const atoms = new Uint32Array(side.nodes.length);
  for (let i = atoms.length - 1; i >= 0; i--) {
    if (isContentAtom(side.tree, side.node(i))) atoms[i] = 1;
    else
      for (const c of side.childrenOf(i))
        atoms[i] = (atoms[i] as number) + (atoms[c] as number);
  }
  return atoms;
}

const localsOf = new WeakMap<Tree, WeakMap<ScopeRules, Locals>>();
const witnessOf = new WeakMap<
  Side,
  { b: Side; scope?: ScopeRules; wa: WitnessSide; wb: WitnessSide }
>();

function resolved(
  tree: Tree,
  scope: ScopeRules | undefined,
): Locals | undefined {
  if (!scope) return undefined;
  let byScope = localsOf.get(tree);
  if (!byScope) {
    byScope = new WeakMap();
    localsOf.set(tree, byScope);
  }
  let locals = byScope.get(scope);
  if (!locals) {
    locals = resolveLocals(tree, scope);
    byScope.set(scope, locals);
  }
  return locals;
}

/** Both sides' witness data, kept while the same pair of sides is classified again. */
function sidesOf(
  a: Side,
  b: Side,
  scope: ScopeRules | undefined,
): [WitnessSide, WitnessSide] {
  const cached = witnessOf.get(a);
  if (cached && cached.b === b && cached.scope === scope)
    return [cached.wa, cached.wb];
  const intern = new Map<string, number>();
  const wa = witnessSide(a, intern, resolved(a.tree, scope));
  const wb = witnessSide(b, intern, resolved(b.tree, scope));
  witnessOf.set(a, { b, ...(scope && { scope }), wa, wb });
  return [wa, wb];
}

/**
 * The witness for showing base index `x` as moved to head index `y`, or undefined when it is honestly a delete
 * plus an insert: too small for "moved" to mean anything (`return null;`), a different declaration, or too little
 * carried over in whole units. It reads the two subtrees only, never the mapping: the matcher proposes, this decides.
 */
export function classifyMove(
  { a, b }: Pick<Mapping, "a" | "b">,
  x: number,
  y: number,
  opts: MoveOptions = defaultMoveOptions,
): MoveWitness | undefined {
  const [sa, sb] = sidesOf(a, b, opts.scope);
  const atomsX = sa.atoms[x] as number;
  const atomsY = sb.atoms[y] as number;
  if (atomsX < opts.minAtoms || atomsY < opts.minAtoms) return undefined;
  if (sa.iso[x] === sb.iso[y]) return { kind: "pure" };
  const nx = a.node(x);
  const ny = b.node(y);
  if (a.tree.kindName(nx) !== b.tree.kindName(ny)) return undefined;
  // `const start = max(v, 0)` and a new `const first = floor(max(v, 0) / n)` share most tokens, but a different
  // name is a different declaration: pairing them shows the old one moved when its value was only inlined.
  const nameX = nameOf(a.tree, nx);
  const nameY = nameOf(b.tree, ny);
  if (nameX !== undefined && nameY !== undefined && nameX !== nameY)
    return undefined;
  const found = unitCore(
    sa,
    [x],
    sb,
    y,
    (i) => sa.alpha[i] as number,
    (t) => sb.alpha[t] as number,
    opts.minAtoms,
    (i, t) => (sa.atoms[i] as number) - renamed(sa, i, sb, t),
  );
  if (!found || 2 * found.w < atomsX || 2 * found.w < atomsY) return undefined;
  return { kind: "edited", core: found.pairs, weight: found.w };
}

/** Past this many candidate pairs the core search is not run, and no core is found. */
const maxPairs = 4096;

type Span = { start: number; end: number };

/**
 * The heaviest unit core between the subtrees at `roots` of `sa` and the one at `root` of `sb`, whose ids `idA` and
 * `idB` give: whole units (or the roots themselves) of two atoms or more with equal ids, disjoint and in order on
 * both sides, one pair weighing `k` or more. Returns its weight `w` and its pairs; undefined when no such core
 * exists or the search is too large to run.
 */
export function unitCore(
  sa: Pick<WitnessSide, "side" | "atoms">,
  roots: readonly number[],
  sb: Pick<WitnessSide, "side" | "atoms">,
  root: number,
  idA: (i: number) => number,
  idB: (t: number) => number,
  k: number,
  weight: (i: number, t: number) => number = (i) => sa.atoms[i] as number,
): { w: number; pairs: [number, number][] } | undefined {
  const ta = sa.side.tree;
  const tb = sb.side.tree;
  const targets = new Map<number, number[]>();
  for (
    let t = root, end = root + (sb.side.size[root] as number);
    t < end;
    t++
  ) {
    if (t !== root && !isUnit(tb, sb.side.node(t))) continue;
    const id = idB(t);
    const list = targets.get(id);
    if (list) list.push(t);
    else targets.set(id, [t]);
  }
  type Pair = { s: Span; t: Span; w: number; i: number; ti: number };
  const pairs: Pair[] = [];
  const span = (tree: Tree, n: number): Span => ({
    start: tree.start(n),
    end: tree.end(n),
  });
  for (const r of roots) {
    const stack = [r];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      if ((sa.atoms[i] as number) < 2) continue;
      const ts =
        (i === r || isUnit(ta, sa.side.node(i))) && targets.get(idA(i));
      if (ts) {
        for (const t of ts)
          pairs.push({
            s: span(ta, sa.side.node(i)),
            t: span(tb, sb.side.node(t)),
            w: weight(i, t),
            i,
            ti: t,
          });
        if (pairs.length > maxPairs) return undefined;
        continue;
      }
      stack.push(...sa.side.childrenOf(i));
    }
  }
  pairs.sort((p, q) => p.s.start - q.s.start || p.t.start - q.t.start);
  // `any[j]`: the heaviest chain ending at pair j; `big[j]`: the heaviest such chain holding a pair of `k` atoms,
  // each with the pair before it in `anyFrom` / `bigFrom`.
  const any: number[] = [];
  const big: number[] = [];
  const anyFrom: number[] = [];
  const bigFrom: { from: number; big: boolean }[] = [];
  let best: number | undefined;
  let bestAt = -1;
  for (const [j, p] of pairs.entries()) {
    let a = 0;
    let ai = -1;
    let b = Number.NEGATIVE_INFINITY;
    let bi = -1;
    for (let i = 0; i < j; i++) {
      const q = pairs[i] as Pair;
      if (q.s.end > p.s.start || q.t.end > p.t.start) continue;
      if ((any[i] as number) > a) [a, ai] = [any[i] as number, i];
      if ((big[i] as number) > b) [b, bi] = [big[i] as number, i];
    }
    any[j] = a + p.w;
    anyFrom[j] = ai;
    if (p.w >= k && a >= b) {
      big[j] = a + p.w;
      bigFrom[j] = { from: ai, big: false };
    } else {
      big[j] = b + p.w;
      bigFrom[j] = { from: bi, big: true };
    }
    if ((big[j] as number) > (best ?? 0)) {
      best = big[j];
      bestAt = j;
    }
  }
  if (best === undefined) return undefined;
  const chosen: [number, number][] = [];
  for (let j = bestAt, inBig = true; j >= 0;) {
    const p = pairs[j] as Pair;
    chosen.push([p.i, p.ti]);
    if (inBig) {
      const f = bigFrom[j] as { from: number; big: boolean };
      j = f.from;
      inBig = f.big;
    } else j = anyFrom[j] as number;
  }
  return { w: best, pairs: chosen.reverse() };
}

/** The atoms of the alpha-equal pair at `i` of `sa` and `t` of `sb` equal only because a local was renamed. */
function renamed(
  sa: WitnessSide,
  i: number,
  sb: WitnessSide,
  t: number,
): number {
  if (!sa.locals) return 0;
  let out = 0;
  for (let k = 0, size = sa.side.size[i] as number; k < size; k++) {
    const m = sa.side.node(i + k);
    if (
      sa.locals.of.has(m) &&
      sa.side.tree.label(m) !== sb.side.tree.label(sb.side.node(t + k))
    )
      out++;
  }
  return out;
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
