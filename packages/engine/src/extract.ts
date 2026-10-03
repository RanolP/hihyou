import { diffArrays } from "diff";
import { NO_NODE, type Tree } from "syntechs/core";
import {
  atomCounts,
  defaultMoveOptions,
  isoIds,
  type Mapping,
  nameOf,
  type RawEdit,
  type Side,
  unitCore,
} from "syntechs/diff";
import type { Version } from "./file.js";
import { wholeDeclaration } from "./fragments.js";

/** One file's edit script as `findExtracts` reads it; `b` is the after side's display version. */
export interface ExtractInput {
  mapping: Mapping;
  edits: readonly RawEdit[];
  /** The after side's nodes a cross-file move claimed, by index. */
  claimed?: Uint8Array;
  b: Version & { tree: Tree };
  declarations?: ReadonlySet<string>;
}

/**
 * Code at a site of file `from` that went into the new declaration `b`, named `name`, of file `to`. `a` is the
 * before node holding the removed code; `emphasis` the leaves of `b` that are not that code carried over.
 */
export interface Extract {
  from: number;
  to: number;
  a: number;
  b: number;
  name: string;
  emphasis: number[];
  /** The removed code itself: the deletes under `a` the declaration carries on. */
  removed: number[];
}

type Declaration = {
  file: number;
  node: number;
  name: string;
  words: Set<string>;
};

/**
 * Pairs an extract refactor's two ends, as a move's: removed code at one site, and a new top-level declaration
 * the code at that site now calls. Shared words propose the pair: the site is the nearest node the inserted
 * reference sits in that the after side kept, and the removed code the deletes inside its before partner that
 * share at least a third of their words with the declaration; together they must share half, and two words at
 * least. A witness decides it (`docs/design/move-theory.md`, "Extract"): the declaration's body with each parameter
 * replaced by the argument the call passes holds whole units of the removed code, in order, carrying half its
 * content atoms and one unit of `k` atoms or more. A declaration two sites could claim, or a delete two
 * declarations could, is claimed by none; any new declaration left over stays an addition.
 */
export function findExtracts(
  files: readonly (ExtractInput | undefined)[],
): Extract[] {
  const byName = new Map<string, Declaration[]>();
  files.forEach((f, file) => {
    if (!f) return;
    const tb = f.b.tree;
    // Unmatched rather than inserted: a piece of it paired as a move from elsewhere leaves the rest new.
    for (const node of namedChildren(tb, tb.root)) {
      const i = f.mapping.b.index(node);
      if ((f.mapping.dst[i] ?? -1) !== -1 || f.claimed?.[i] === 1) continue;
      const name =
        wholeDeclaration(f.b, tb, node, f.declarations, undefined) &&
        nameOf(tb, node);
      if (!name) continue;
      const list = byName.get(name) ?? [];
      list.push({ file, node, name, words: new Set(words(tb, node)) });
      byName.set(name, list);
    }
  });
  if (byName.size === 0) return [];

  const witnessed = substitutionWitness(files);
  type Site = { d: Declaration; from: number; removed: number[] };
  const sites: Site[] = [];
  files.forEach((f, from) => {
    if (!f) return;
    const { mapping } = f;
    const ta = mapping.a.tree;
    const tb = f.b.tree;
    const deletes = f.edits.flatMap((e) =>
      e.kind === "delete" && e.a !== undefined ? [e.a] : [],
    );
    if (deletes.length === 0) return;
    for (const e of f.edits) {
      if (e.kind !== "insert" || e.b === undefined || e.b === tb.root) continue;
      for (const name of references(tb, e.b)) {
        const [d] = byName.get(name) ?? [];
        if (
          !d ||
          byName.get(name)?.length !== 1 ||
          (d.file === from && within(tb, e.b, d.node))
        )
          continue;
        const kept = keptAncestor(mapping, e.b);
        if (kept === undefined || kept === ta.root) continue;
        let shared = 0;
        let total = 0;
        const removed: number[] = [];
        for (const x of deletes) {
          if (!within(ta, x, kept)) continue;
          const ws = words(ta, x);
          const n = ws.filter((w) => d.words.has(w)).length;
          if (n * 3 < ws.length || n === 0) continue;
          removed.push(x);
          shared += n;
          total += ws.length;
        }
        if (shared < 2 || shared * 2 < total) continue;
        if (witnessed(from, e.b, d, removed)) sites.push({ d, from, removed });
      }
    }
  });

  const claims = new Map<Declaration | string, number>();
  const keys = (s: Site) => [s.d, ...s.removed.map((x) => `${s.from}:${x}`)];
  for (const s of sites)
    for (const k of keys(s)) claims.set(k, (claims.get(k) ?? 0) + 1);
  const out: Extract[] = [];
  for (const site of sites) {
    const ta = files[site.from]?.mapping.a.tree;
    const tb = files[site.d.file]?.b.tree;
    if (!ta || !tb || keys(site).some((k) => claims.get(k) !== 1)) continue;
    out.push({
      from: site.from,
      to: site.d.file,
      a: commonAncestor(ta, site.removed),
      b: site.d.node,
      name: site.d.name,
      emphasis: generalized(ta, site.removed, tb, site.d.node),
      removed: site.removed,
    });
  }
  return out;
}

/**
 * Whether the before nodes `removed` of file `from` are carried by declaration `d`, called once inside the inserted
 * node `holder`: `σ` maps each of `d`'s parameters to the argument that call passes, and a unit core between
 * `removed` and `d`'s body under `σ` weighs `k` in one pair and half of `removed`'s content atoms in all.
 */
function substitutionWitness(files: readonly (ExtractInput | undefined)[]) {
  const k = defaultMoveOptions.minAtoms;
  const intern = new Map<string, number>();
  const isos = new Map<Side, Int32Array>();
  const atoms = new Map<Side, Uint32Array>();
  const isoOf = (s: Side) => {
    let ids = isos.get(s);
    if (!ids) {
      ids = isoIds(s, intern);
      isos.set(s, ids);
    }
    return ids;
  };
  const atomsOf = (s: Side) => {
    let out = atoms.get(s);
    if (!out) {
      out = atomCounts(s);
      atoms.set(s, out);
    }
    return out;
  };
  return (
    from: number,
    holder: number,
    d: { file: number; node: number; name: string },
    removed: number[],
  ): boolean => {
    const site = files[from]?.mapping;
    const into = files[d.file]?.mapping.b;
    if (!site || !into) return false;
    const body = bodyOf(into.tree, d.node);
    const call = callTo(site.b.tree, holder, d.name);
    if (body === undefined || call === undefined) return false;
    const sigma = substitution(into.tree, body, site.b.tree, call);
    if (!sigma) return false;
    const before = atomsOf(site.a);
    const roots = removed.map((n) => site.a.index(n));
    const size = roots.reduce((s, i) => s + (before[i] as number), 0);
    const b = into.index(body);
    if (size < k || (atomsOf(into)[b] as number) < k) return false;
    const args = isoOf(site.b);
    const argIds = new Map(
      [...sigma].map(([p, n]) => [p, args[site.b.index(n)] as number]),
    );
    const ids = substitutedIds(intern, into, b, argIds);
    const aIso = isoOf(site.a);
    const found = unitCore(
      { side: site.a, atoms: before },
      roots,
      { side: into, atoms: atomsOf(into) },
      b,
      (i) => aIso[i] as number,
      (t) => ids[t - b] as number,
      k,
    );
    return found !== undefined && 2 * found.w >= size;
  };
}

/** The one call to `name` by a plain identifier inside `n`; undefined when there is none or more than one. */
function callTo(tree: Tree, n: number, name: string): number | undefined {
  let found: number | undefined;
  const stack = [n];
  while (stack.length > 0) {
    const m = stack.pop() as number;
    const callee = fieldChild(tree, m, "function");
    if (
      callee !== undefined &&
      tree.count(callee) === 0 &&
      tree.kindName(callee) === "identifier" &&
      tree.label(callee) === name &&
      fieldChild(tree, m, "arguments") !== undefined
    ) {
      if (found !== undefined) return undefined;
      found = m;
    }
    for (let i = tree.count(m) - 1; i >= 0; i--) stack.push(tree.child(m, i));
  }
  return found;
}

/**
 * `σ`: each parameter of the function whose body is `body` to the argument node `call` (a node of `site`) passes
 * it, in order. Undefined unless every parameter is a plain name without a default and the counts agree.
 */
function substitution(
  tree: Tree,
  body: number,
  site: Tree,
  call: number,
): Map<string, number> | undefined {
  const fn = tree.parent(body);
  if (fn === NO_NODE) return undefined;
  const params =
    fieldChild(tree, fn, "parameters") ?? fieldChild(tree, fn, "parameter");
  const argList = fieldChild(site, call, "arguments");
  if (params === undefined || argList === undefined) return undefined;
  const names: string[] = [];
  for (const p of tree.kindName(params) === "identifier"
    ? [params]
    : namedChildren(tree, params)) {
    const name = paramName(tree, p);
    if (name === undefined) return undefined;
    names.push(name);
  }
  const args = namedChildren(site, argList);
  if (
    args.length !== names.length ||
    args.some((a) => site.kindName(a).includes("spread"))
  )
    return undefined;
  const out = new Map<string, number>();
  for (const [i, name] of names.entries()) {
    if (out.has(name)) return undefined;
    out.set(name, args[i] as number);
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
 * Iso ids of the subtree at index `b` of `side`, offset by `b`, with each occurrence of a parameter standing for
 * its argument's id in `args`, numbered through `intern` like `isoIds` so they compare with the removed code's.
 */
function substitutedIds(
  intern: Map<string, number>,
  side: Side,
  b: number,
  args: Map<string, number>,
): Int32Array {
  const { tree } = side;
  const size = side.size[b] as number;
  const ids = new Int32Array(size);
  for (let i = b + size - 1; i >= b; i--) {
    const n = side.node(i);
    const arg =
      tree.kindName(n) === "identifier" && tree.count(n) === 0
        ? args.get(tree.label(n))
        : undefined;
    if (arg !== undefined) {
      ids[i - b] = arg;
      continue;
    }
    const kids = side.childrenOf(i).map((c) => ids[c - b]);
    const key = `${tree.kindName(n)}\0${tree.label(n)}\0${kids.join(",")}`;
    let id = intern.get(key);
    if (id === undefined) {
      id = intern.size;
      intern.set(key, id);
    }
    ids[i - b] = id;
  }
  return ids;
}

function fieldChild(tree: Tree, n: number, field: string): number | undefined {
  for (let i = 0, count = tree.count(n); i < count; i++)
    if (tree.fieldName(tree.child(n, i)) === field) return tree.child(n, i);
  return undefined;
}

/**
 * The leaves of declaration `d`'s body whose words are not the removed code's, in order: what the extract
 * generalized. The signature is new by definition, and the label already says the declaration is.
 */
function generalized(
  ta: Tree,
  removed: number[],
  tb: Tree,
  d: number,
): number[] {
  const before = removed.flatMap((x) => words(ta, x));
  const leaves = wordLeaves(tb, bodyOf(tb, d) ?? d);
  const after = leaves.flatMap((l) => l.words);
  const fresh = new Set<number>();
  let i = 0;
  for (const part of diffArrays(before, after)) {
    if (part.removed) continue;
    if (part.added) for (let k = 0; k < part.count; k++) fresh.add(i + k);
    i += part.count;
  }
  const out: number[] = [];
  let at = 0;
  for (const l of leaves) {
    if (l.words.some((_, k) => fresh.has(at + k))) out.push(l.node);
    at += l.words.length;
  }
  return out;
}

const word = /[\p{L}_$][\p{L}\p{N}_$]*/gu;

/** The words of a subtree's named leaves, comments left out: what code says, not how it is punctuated. */
function words(tree: Tree, n: number): string[] {
  return wordLeaves(tree, n).flatMap((l) => l.words);
}

function wordLeaves(
  tree: Tree,
  n: number,
): { node: number; words: string[] }[] {
  const out: { node: number; words: string[] }[] = [];
  const stack = [n];
  while (stack.length > 0) {
    const m = stack.pop() as number;
    const count = tree.count(m);
    if (count === 0) {
      if (!tree.named(m) || tree.kindName(m).includes("comment")) continue;
      const ws = tree.label(m).match(word);
      if (ws) out.push({ node: m, words: ws });
      continue;
    }
    for (let k = count - 1; k >= 0; k--) stack.push(tree.child(m, k));
  }
  return out;
}

/** Identifier names used inside `n`, import lines aside, since importing a new declaration is not using it. */
function references(tree: Tree, n: number): Set<string> {
  const out = new Set<string>();
  if (inImport(tree, n)) return out;
  const stack = [n];
  while (stack.length > 0) {
    const m = stack.pop() as number;
    const count = tree.count(m);
    if (count === 0 && tree.kindName(m) === "identifier")
      out.add(tree.label(m));
    if (tree.kindName(m).startsWith("import")) continue;
    for (let k = 0; k < count; k++) stack.push(tree.child(m, k));
  }
  return out;
}

/** The before partner of `n`'s nearest ancestor that the matcher kept. */
function keptAncestor(mapping: Mapping, n: number): number | undefined {
  const tb = mapping.b.tree;
  for (let p = tb.parent(n); p !== NO_NODE; p = tb.parent(p)) {
    const partner = mapping.dst[mapping.b.index(p)] ?? -1;
    if (partner !== -1) return mapping.a.node(partner);
  }
  return undefined;
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

function within(tree: Tree, n: number, ancestor: number): boolean {
  return (
    tree.start(ancestor) <= tree.start(n) && tree.end(n) <= tree.end(ancestor)
  );
}

function commonAncestor(tree: Tree, nodes: number[]): number {
  const [first, ...rest] = nodes;
  let c = first ?? tree.root;
  while (c !== tree.root && !rest.every((n) => within(tree, n, c)))
    c = tree.parent(c);
  return c;
}

function inImport(tree: Tree, n: number): boolean {
  for (let p = n; p !== NO_NODE; p = tree.parent(p))
    if (tree.kindName(p).startsWith("import")) return true;
  return false;
}

function namedChildren(tree: Tree, n: number): number[] {
  const out: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++)
    if (tree.named(tree.child(n, i))) out.push(tree.child(n, i));
  return out;
}
