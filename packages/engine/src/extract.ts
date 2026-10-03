import { diffArrays } from "diff";
import { NO_NODE, type Tree } from "syntechs/core";
import { type Mapping, nameOf, type RawEdit } from "syntechs/diff";
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
 * the code at that site now calls, whose body carries most of the removed words. The site is the nearest node
 * the inserted reference sits in that the after side kept, and the removed code the deletes inside its before
 * partner that share at least a third of their words with the declaration; together they must share half, and
 * two words at least. A declaration pairs with one site, the one sharing the most words, and a delete with one
 * declaration; any other new declaration stays an addition.
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

  type Site = {
    d: Declaration;
    from: number;
    removed: number[];
    shared: number;
  };
  const best = new Map<Declaration, Site>();
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
        const prev = best.get(d);
        if (!prev || shared > prev.shared)
          best.set(d, { d, from, removed, shared });
      }
    }
  });

  const used = files.map(() => new Set<number>());
  const out: Extract[] = [];
  for (const site of [...best.values()].sort((p, q) => q.shared - p.shared)) {
    const taken = used[site.from];
    const ta = files[site.from]?.mapping.a.tree;
    const tb = files[site.d.file]?.b.tree;
    if (!taken || !ta || !tb || site.removed.some((x) => taken.has(x)))
      continue;
    for (const x of site.removed) taken.add(x);
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
