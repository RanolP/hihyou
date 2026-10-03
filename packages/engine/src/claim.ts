import { NO_NODE, type Tree } from "syntechs/core";
import {
  contentAtoms,
  isContentAtom,
  isoIds,
  isUnit,
  nameOf,
  Side,
} from "syntechs/diff";

/**
 * The checker every move and extract claim passes before the engine emits it; see `docs/design/move-theory.md`.
 * It reads the two trees and the claim alone, never a matcher's mapping, so no heuristic upstream can make an
 * emitted claim false: a claim it rejects is shown as a delete plus an insert.
 */

/** `k`: the content atoms each half of a claim needs, and the heaviest carried unit of an edited one. */
export const minAtoms = 4;

/** One file of the Diffset, both trees when it has them. */
export interface ClaimFile {
  before?: Tree;
  after?: Tree;
  declarations?: ReadonlySet<string>;
}

/**
 * A move of before node `x` of file `from` to after node `y` of file `to`, or an extract: the before nodes
 * `removed` of file `from`, under `site`, replaced by a call to the new declaration `declaration` of file `to`.
 */
export type Claim =
  | {
      kind: "move";
      from: number;
      to: number;
      x: number;
      y: number;
      edited: boolean;
    }
  | {
      kind: "extract";
      from: number;
      to: number;
      site: number;
      removed: readonly number[];
      declaration: number;
      name: string;
    };

/**
 * The condition a claim failed: `F0` size, `F1` moved at all, `F2p` equal, `F2e` an edited move's core, `F2x` an
 * extract's substituted core, `F3` nothing else in the Diffset could claim as much.
 */
export type Condition = "F0" | "F1" | "F2p" | "F2e" | "F2x" | "F3";

interface SideData {
  side: Side;
  tree: Tree;
  iso: Int32Array;
  /** `|C|` of each index's subtree. */
  atoms: Uint32Array;
}

interface FileData {
  before?: SideData;
  after?: SideData;
  declarations?: ReadonlySet<string>;
}

type Span = { start: number; end: number };

export interface ClaimContext {
  files: FileData[];
  intern: Map<string, number>;
  countBefore: Map<number, number>;
  countAfter: Map<number, number>;
  anchors: Map<number, { a: Span; b: Span }[]>;
  byKind?: {
    before: Map<string, [number, number][]>;
    after: Map<string, [number, number][]>;
  };
  calls?: Map<string, [number, number][]>;
  fresh?: Map<string, [number, number][]>;
  bags: Map<string, Map<string, number>>;
}

export function createClaimContext(
  files: readonly (ClaimFile | undefined)[],
): ClaimContext {
  const intern = new Map<string, number>();
  const countBefore = new Map<number, number>();
  const countAfter = new Map<number, number>();
  const data = (tree: Tree, counts: Map<number, number>): SideData => {
    const side = Side.of(tree);
    const iso = isoIds(side, intern);
    for (const id of iso) counts.set(id, (counts.get(id) ?? 0) + 1);
    const atoms = new Uint32Array(side.nodes.length);
    for (let i = atoms.length - 1; i >= 0; i--) {
      if (isContentAtom(tree, side.node(i))) atoms[i] = 1;
      else
        for (const c of side.childrenOf(i))
          atoms[i] = (atoms[i] as number) + (atoms[c] as number);
    }
    return { side, tree, iso, atoms };
  };
  return {
    files: files.map((f) => ({
      ...(f?.before && { before: data(f.before, countBefore) }),
      ...(f?.after && { after: data(f.after, countAfter) }),
      ...(f?.declarations && { declarations: f.declarations }),
    })),
    intern,
    countBefore,
    countAfter,
    anchors: new Map(),
    bags: new Map(),
  };
}

/** The first condition `claim` fails, or undefined when every fact it asserts holds of the two trees. */
export function checkClaim(
  ctx: ClaimContext,
  claim: Claim,
): Condition | undefined {
  return claim.kind === "move"
    ? checkMove(ctx, claim)
    : checkExtract(ctx, claim);
}

function checkMove(
  ctx: ClaimContext,
  c: Claim & { kind: "move" },
): Condition | undefined {
  const sa = ctx.files[c.from]?.before;
  const sb = ctx.files[c.to]?.after;
  if (!sa || !sb) return "F0";
  const x = sa.side.index(c.x);
  const y = sb.side.index(c.y);
  if ((sa.atoms[x] as number) < minAtoms || (sb.atoms[y] as number) < minAtoms)
    return "F0";
  if (!moved(ctx, c.from, c.x, c.to, c.y)) return "F1";
  const idX = sa.iso[x] as number;
  const idY = sb.iso[y] as number;
  const before = (id: number) => ctx.countBefore.get(id) ?? 0;
  const after = (id: number) => ctx.countAfter.get(id) ?? 0;
  if (!c.edited) {
    if (idX !== idY) return "F2p";
    return before(idX) === 1 && after(idY) === 1 ? undefined : "F3";
  }
  if (sa.tree.kindName(c.x) !== sb.tree.kindName(c.y)) return "F2e";
  const w = core(sa, [x], sb, y, (t) => sb.iso[t] as number);
  if (
    w === undefined ||
    2 * w < (sa.atoms[x] as number) ||
    2 * w < (sb.atoms[y] as number)
  )
    return "F2e";
  // A pure witness elsewhere outranks this one.
  if (
    before(idX) !== 1 ||
    after(idX) !== 0 ||
    after(idY) !== 1 ||
    before(idY) !== 0
  )
    return "F3";
  const kind = sa.tree.kindName(c.x);
  if (rival(ctx, "after", kind, bag(ctx, "before", c.from, x), c.to, y))
    return "F3";
  if (rival(ctx, "before", kind, bag(ctx, "after", c.to, y), c.from, x))
    return "F3";
  return undefined;
}

/**
 * Whether some node of `kind` on `side` other than `(file, i)` could hold a core with the code whose content bag is
 * `own`: by the bound `w ≤ |C(own) ∩ C(n)|`, one whose shared atoms reach half of both is not ruled out.
 */
function rival(
  ctx: ClaimContext,
  side: "before" | "after",
  kind: string,
  own: Map<string, number>,
  file: number,
  i: number,
): boolean {
  const size = total(own);
  for (const [f, n] of kinds(ctx)[side].get(kind) ?? []) {
    if (f === file && n === i) continue;
    const s = ctx.files[f]?.[side];
    const atoms = s?.atoms[n] as number;
    // Under half of `own`, or over twice its size, the shared atoms cannot reach half of both.
    if (!s || 2 * atoms < size || atoms > 2 * size) continue;
    const shared = intersect(own, bag(ctx, side, f, n));
    if (2 * shared >= size && 2 * shared >= atoms) return true;
  }
  return false;
}

function kinds(ctx: ClaimContext): NonNullable<ClaimContext["byKind"]> {
  if (ctx.byKind) return ctx.byKind;
  const index = (side: "before" | "after") => {
    const out = new Map<string, [number, number][]>();
    ctx.files.forEach((f, file) => {
      const s = f[side];
      if (!s) return;
      for (let i = 0; i < s.side.nodes.length; i++) {
        if ((s.atoms[i] as number) < minAtoms) continue;
        const k = s.tree.kindName(s.side.node(i));
        const list = out.get(k);
        if (list) list.push([file, i]);
        else out.set(k, [[file, i]]);
      }
    });
    return out;
  };
  ctx.byKind = { before: index("before"), after: index("after") };
  return ctx.byKind;
}

function bag(
  ctx: ClaimContext,
  side: "before" | "after",
  file: number,
  i: number,
): Map<string, number> {
  const key = `${side}:${file}:${i}`;
  let out = ctx.bags.get(key);
  if (out) return out;
  const s = ctx.files[file]?.[side];
  out = s ? count(contentAtoms(s.tree, s.side.node(i))) : new Map();
  ctx.bags.set(key, out);
  return out;
}

function count(
  labels: Iterable<string>,
  into = new Map<string, number>(),
): Map<string, number> {
  for (const l of labels) into.set(l, (into.get(l) ?? 0) + 1);
  return into;
}

const total = (bag: Map<string, number>) =>
  [...bag.values()].reduce((s, n) => s + n, 0);

function intersect(p: Map<string, number>, q: Map<string, number>): number {
  let out = 0;
  for (const [l, n] of p) out += Math.min(n, q.get(l) ?? 0);
  return out;
}

/**
 * F1, from the trees alone: different files, different declaration chains, or a unique anchor that `x` and `y`
 * stand on opposite sides of.
 */
function moved(
  ctx: ClaimContext,
  from: number,
  x: number,
  to: number,
  y: number,
): boolean {
  if (from !== to) return true;
  const f = ctx.files[from];
  if (!f?.before || !f.after) return true;
  if (
    chain(f.before.tree, x, f.declarations) !==
    chain(f.after.tree, y, f.declarations)
  )
    return true;
  const ta = f.before.tree;
  const tb = f.after.tree;
  return anchors(ctx, from).some(
    ({ a, b }) =>
      (ta.end(x) <= a.start && tb.start(y) >= b.end) ||
      (ta.start(x) >= a.end && tb.end(y) <= b.start),
  );
}

/** The kinds and names of the declarations around `n`, outermost first. */
function chain(
  tree: Tree,
  n: number,
  declarations: ReadonlySet<string> | undefined,
): string {
  const out: string[] = [];
  if (!declarations) return "";
  for (let p = tree.parent(n); p !== NO_NODE; p = tree.parent(p))
    if (declarations.has(tree.kindName(p)))
      out.push(`${tree.kindName(p)}\0${nameOf(tree, p) ?? ""}`);
  return out.reverse().join("\u0001");
}

/** Pairs of subtrees of two or more atoms whose iso id occurs exactly once in each side of `file`. */
function anchors(ctx: ClaimContext, file: number): { a: Span; b: Span }[] {
  const cached = ctx.anchors.get(file);
  if (cached) return cached;
  const f = ctx.files[file];
  const out: { a: Span; b: Span }[] = [];
  if (f?.before && f.after) {
    const once = (s: SideData) => {
      const seen = new Map<number, number>();
      for (let i = 0; i < s.iso.length; i++) {
        const id = s.iso[i] as number;
        seen.set(id, seen.has(id) ? -1 : i);
      }
      return seen;
    };
    const ua = once(f.before);
    const ub = once(f.after);
    for (const [id, i] of ua) {
      const j = ub.get(id);
      if (
        i === -1 ||
        j === undefined ||
        j === -1 ||
        (f.before.atoms[i] as number) < 2
      )
        continue;
      const na = f.before.side.node(i);
      const nb = f.after.side.node(j);
      out.push({
        a: { start: f.before.tree.start(na), end: f.before.tree.end(na) },
        b: { start: f.after.tree.start(nb), end: f.after.tree.end(nb) },
      });
    }
  }
  ctx.anchors.set(file, out);
  return out;
}

/** Past this many candidate pairs the core search is not run and the claim is declined. */
const maxPairs = 4096;

/**
 * The heaviest core between the subtrees at `roots` of `sa` and the one at `root` of `sb`, whose ids `idOf` gives:
 * whole units (or the roots themselves) of two atoms or more with equal ids, disjoint and in order on both sides,
 * holding a pair of `k` atoms or more. Returns its weight `w`, counted in the atoms of the `sa` side; undefined
 * when no such core exists, or the search is too large to run.
 */
function core(
  sa: SideData,
  roots: readonly number[],
  sb: SideData,
  root: number,
  idOf: (t: number) => number,
): number | undefined {
  const targets = new Map<number, number[]>();
  for (
    let t = root, end = root + (sb.side.size[root] as number);
    t < end;
    t++
  ) {
    if (t !== root && !isUnit(sb.tree, sb.side.node(t))) continue;
    const id = idOf(t);
    const list = targets.get(id);
    if (list) list.push(t);
    else targets.set(id, [t]);
  }
  type Pair = { s: Span; t: Span; w: number };
  const pairs: Pair[] = [];
  const span = (d: SideData, i: number): Span => {
    const n = d.side.node(i);
    return { start: d.tree.start(n), end: d.tree.end(n) };
  };
  for (const r of roots) {
    const stack = [r];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const w = sa.atoms[i] as number;
      if (w < 2) continue;
      const ts =
        (i === r || isUnit(sa.tree, sa.side.node(i))) &&
        targets.get(sa.iso[i] as number);
      if (ts) {
        for (const t of ts) pairs.push({ s: span(sa, i), t: span(sb, t), w });
        if (pairs.length > maxPairs) return undefined;
        continue;
      }
      stack.push(...sa.side.childrenOf(i));
    }
  }
  pairs.sort((p, q) => p.s.start - q.s.start || p.t.start - q.t.start);
  // `any[j]`: the heaviest chain ending at pair j; `big[j]`: the heaviest such chain holding a pair of `k` atoms.
  const any: number[] = [];
  const big: number[] = [];
  let best: number | undefined;
  for (const [j, p] of pairs.entries()) {
    let a = 0;
    let b = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < j; i++) {
      const q = pairs[i] as Pair;
      if (q.s.end > p.s.start || q.t.end > p.t.start) continue;
      a = Math.max(a, any[i] as number);
      b = Math.max(b, big[i] as number);
    }
    any[j] = a + p.w;
    big[j] = p.w >= minAtoms ? Math.max(a, b) + p.w : b + p.w;
    if ((big[j] as number) > (best ?? 0)) best = big[j];
  }
  return best;
}

function checkExtract(
  ctx: ClaimContext,
  c: Claim & { kind: "extract" },
): Condition | undefined {
  const sa = ctx.files[c.from]?.before;
  const sb = ctx.files[c.to]?.after;
  const site = ctx.files[c.from]?.after;
  if (!sa || !sb || !site) return "F0";
  const removed = c.removed.map((n) => sa.side.index(n));
  const size = removed.reduce((s, i) => s + (sa.atoms[i] as number), 0);
  const body = bodyOf(sb.tree, c.declaration);
  if (body === undefined) return "F2x";
  const b = sb.side.index(body);
  if (size < minAtoms || (sb.atoms[b] as number) < minAtoms) return "F0";
  if (!moved(ctx, c.from, c.site, c.to, c.declaration)) return "F1";
  // One call to the new name in the whole Diffset, at the site, or another site could claim the declaration.
  const callers = calls(ctx).get(c.name) ?? [];
  const [call] = callers;
  if (callers.length !== 1 || !call || call[0] !== c.from) return "F3";
  const sigma = substitution(sb.tree, body, site, call[1]);
  if (!sigma) return "F2x";
  const ids = substitutedIds(ctx, sb, b, site, sigma);
  const w = core(sa, removed, sb, b, (t) => ids[t - b] as number);
  if (w === undefined || 2 * w < size) return "F2x";
  // No other new declaration called from the same file may share half of the removed code's content.
  const own = new Map<string, number>();
  for (const i of removed) count(contentAtoms(sa.tree, sa.side.node(i)), own);
  for (const [name, list] of calls(ctx)) {
    if (name === c.name) continue;
    for (const [file, n] of list) {
      if (file !== c.from) continue;
      for (const [df, d] of freshDeclarations(ctx).get(name) ?? []) {
        const tree = ctx.files[df]?.after?.tree;
        const dbody = tree && bodyOf(tree, d);
        if (!tree || dbody === undefined) continue;
        const s = substitution(tree, dbody, site, n);
        if (!s) continue;
        const theirs = substitutedBag(tree, dbody, site, s);
        const shared = intersect(own, theirs);
        if (2 * shared >= size && 2 * shared >= total(theirs)) return "F3";
      }
    }
  }
  return undefined;
}

/** Every call by a plain identifier in the after trees, by callee name: `[file, call node]`. */
function calls(ctx: ClaimContext): Map<string, [number, number][]> {
  if (ctx.calls) return ctx.calls;
  const out = new Map<string, [number, number][]>();
  ctx.files.forEach((f, file) => {
    const s = f.after;
    if (!s) return;
    for (const n of s.side.nodes) {
      const callee = fieldChild(s.tree, n, "function");
      if (
        callee === undefined ||
        s.tree.kindName(callee) !== "identifier" ||
        s.tree.count(callee) !== 0
      )
        continue;
      if (fieldChild(s.tree, n, "arguments") === undefined) continue;
      const name = s.tree.label(callee);
      const list = out.get(name);
      if (list) list.push([file, n]);
      else out.set(name, [[file, n]]);
    }
  });
  ctx.calls = out;
  return out;
}

/** Top-level declarations of the after trees whose name no before tree declares at top level. */
function freshDeclarations(ctx: ClaimContext): Map<string, [number, number][]> {
  if (ctx.fresh) return ctx.fresh;
  const old = new Set<string>();
  for (const f of ctx.files)
    if (f.before)
      for (const n of namedChildren(f.before.tree, f.before.tree.root))
        old.add(nameOf(f.before.tree, n) ?? "");
  const out = new Map<string, [number, number][]>();
  ctx.files.forEach((f, file) => {
    if (!f.after) return;
    for (const n of namedChildren(f.after.tree, f.after.tree.root)) {
      const name = nameOf(f.after.tree, n);
      if (name === undefined || old.has(name)) continue;
      const list = out.get(name);
      if (list) list.push([file, n]);
      else out.set(name, [[file, n]]);
    }
  });
  ctx.fresh = out;
  return out;
}

/**
 * `σ`: each parameter of the function whose body is `body` to the argument `call` (a node of `site`) passes it, in
 * order. Undefined unless every parameter is a plain name and the counts agree.
 */
function substitution(
  tree: Tree,
  body: number,
  site: SideData,
  call: number,
): Map<string, number> | undefined {
  const fn = tree.parent(body);
  if (fn === NO_NODE) return undefined;
  const params =
    fieldChild(tree, fn, "parameters") ?? fieldChild(tree, fn, "parameter");
  const argList = fieldChild(site.tree, call, "arguments");
  if (params === undefined || argList === undefined) return undefined;
  const names: string[] = [];
  for (const p of tree.kindName(params) === "identifier"
    ? [params]
    : namedChildren(tree, params)) {
    const name = paramName(tree, p);
    if (name === undefined) return undefined;
    names.push(name);
  }
  const args = namedChildren(site.tree, argList);
  if (
    args.length !== names.length ||
    args.some((a) => site.tree.kindName(a).includes("spread"))
  )
    return undefined;
  const out = new Map<string, number>();
  for (const [i, name] of names.entries()) {
    if (out.has(name)) return undefined;
    out.set(name, site.side.index(args[i] as number));
  }
  return out;
}

/** A parameter's own name: an identifier, or one in its `pattern` or `name` field with no default value. */
function paramName(tree: Tree, p: number): string | undefined {
  if (tree.kindName(p) === "identifier") return tree.label(p);
  if (fieldChild(tree, p, "value") !== undefined) return undefined;
  const inner = fieldChild(tree, p, "pattern") ?? fieldChild(tree, p, "name");
  return inner !== undefined && tree.kindName(inner) === "identifier"
    ? tree.label(inner)
    : undefined;
}

/**
 * Iso ids of the subtree at index `b` of `sb`, offset by `b`, with each occurrence of a parameter standing for the
 * id of the argument (an index of `site`) `sigma` maps it to, numbered like every other id of the context.
 */
function substitutedIds(
  ctx: ClaimContext,
  sb: SideData,
  b: number,
  site: SideData,
  sigma: Map<string, number>,
): Int32Array {
  const size = sb.side.size[b] as number;
  const ids = new Int32Array(size);
  for (let i = b + size - 1; i >= b; i--) {
    const n = sb.side.node(i);
    const arg = parameter(sb.tree, n, sigma);
    if (arg !== undefined) {
      ids[i - b] = site.iso[arg] as number;
      continue;
    }
    const kids = sb.side.childrenOf(i).map((k) => ids[k - b]);
    const key = `${sb.tree.kindName(n)}\0${sb.tree.label(n)}\0${kids.join(",")}`;
    let id = ctx.intern.get(key);
    if (id === undefined) {
      id = ctx.intern.size;
      ctx.intern.set(key, id);
    }
    ids[i - b] = id;
  }
  return ids;
}

/** The argument index `n` stands for when it is an occurrence of a parameter `sigma` maps. */
const parameter = (
  tree: Tree,
  n: number,
  sigma: Map<string, number>,
): number | undefined =>
  tree.kindName(n) === "identifier" && tree.count(n) === 0
    ? sigma.get(tree.label(n))
    : undefined;

/** The content bag of the subtree at `body` with each parameter occurrence replaced by its argument's content. */
function substitutedBag(
  tree: Tree,
  body: number,
  site: SideData,
  sigma: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  const stack = [body];
  while (stack.length > 0) {
    const m = stack.pop() as number;
    const arg = parameter(tree, m, sigma);
    if (arg !== undefined)
      count(contentAtoms(site.tree, site.side.node(arg)), out);
    else if (isContentAtom(tree, m)) count(contentAtoms(tree, m), out);
    else
      for (let i = tree.count(m) - 1; i >= 0; i--) stack.push(tree.child(m, i));
  }
  return out;
}

/** The `body` field of `n` or of a node a few levels in (`export` > function, `const` > arrow function). */
function bodyOf(tree: Tree, n: number): number | undefined {
  let level = [n];
  for (let depth = 0; depth < 4 && level.length > 0; depth++) {
    const next: number[] = [];
    for (const m of level)
      for (let k = 0, count = tree.count(m); k < count; k++) {
        const c = tree.child(m, k);
        if (tree.fieldName(c) === "body") return c;
        next.push(c);
      }
    level = next;
  }
  return undefined;
}

function fieldChild(tree: Tree, n: number, field: string): number | undefined {
  for (let i = 0, count = tree.count(n); i < count; i++)
    if (tree.fieldName(tree.child(n, i)) === field) return tree.child(n, i);
  return undefined;
}

function namedChildren(tree: Tree, n: number): number[] {
  const out: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.named(c) && !tree.kindName(c).includes("comment")) out.push(c);
  }
  return out;
}
