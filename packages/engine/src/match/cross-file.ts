import {
  type Claimed,
  defaultMatchOptions,
  type EditScript,
  editScript,
  isoIds,
  type Mapping,
  MatchBudgetExceeded,
  type MatchOptions,
  match,
} from "syntechs/diff";
import { NO_NODE } from "syntechs/core";
import type { RawEdit } from "syntechs/diff";
import type { Tree } from "../parse/tree.js";

/**
 * An edit whose `old` lies in file `from`'s base text and whose `new` in file `to`'s head text,
 * by index into the list given to `crossFileMoves`. An insert has only `to`, a delete only `from`.
 * `whole` marks the move of a declaration itself, as against the edits made inside it on the way.
 * The edit's `a` is a node of `ta`, its `b` of `tb`; a line-mode edit has neither.
 */
export type CrossEdit = {
  edit: RawEdit;
  ta?: Tree;
  tb?: Tree;
  from: number;
  to: number;
  whole?: true;
};

/** Below this many nodes a subtree is too common (`return null;`) to claim that it moved. */
const minMoveSize = 8;

/**
 * Import lines clear `minMoveSize` on punctuation alone, and the same import turns up in many files, so
 * pairing them across files reports noise as moves.
 */
const importKinds = /^(import_statement|import_from_statement)$/;

/**
 * Pairs code deleted from one file with code inserted into another, so a declaration that moved
 * between files is one move rather than a delete here and an insert there. First identical subtrees,
 * largest first; then declarations of the same kind and name, matched inside for the edits made
 * on the way. Paired subtrees are claimed out of their files' mappings, and any same-file match
 * inside them is dropped in favour of the cross-file pairing.
 */
export function crossFileMoves(
  mappings: (Mapping | undefined)[],
  opts: MatchOptions = defaultMatchOptions,
): { claimed: (Claimed | undefined)[]; edits: CrossEdit[] } {
  const intern = new Map<string, number>();
  const iso = mappings.map((m) => m && { a: isoIds(m.a, intern), b: isoIds(m.b, intern) });
  const claimed = mappings.map(
    (m) =>
      m && {
        a: new Uint8Array(m.a.nodes.length),
        b: new Uint8Array(m.b.nodes.length),
      },
  );
  const edits: CrossEdit[] = [];

  /** `i` is `n`'s index in its side, `size` its subtree's node count, `tree` the tree `n` is a node of. */
  type Candidate = {
    file: number;
    i: number;
    size: number;
    n: number;
    tree: Tree;
  };
  const candidates = (side: "a" | "b"): Candidate[] =>
    mappings
      .flatMap((m, file) => {
        if (!m) return [];
        const s = m[side];
        const table = side === "a" ? m.src : m.dst;
        const out: Candidate[] = [];
        for (let i = 1; i < s.nodes.length; i++) {
          const size = s.size[i] as number;
          if (size < minMoveSize || table[i] !== -1) continue;
          const n = s.node(i);
          if (s.tree.named(n) && !inImport(s.tree, n)) out.push({ file, i, size, n, tree: s.tree });
        }
        return out;
      })
      .sort((p, q) => q.size - p.size);
  const fromA = candidates("a");
  const intoB = candidates("b");
  const isClaimed = (side: "a" | "b", c: Candidate) => claimed[c.file]?.[side][c.i] === 1;

  const claim = (x: Candidate, y: Candidate) => {
    for (const [side, c] of [
      ["a", x],
      ["b", y],
    ] as const) {
      const m = mappings[c.file];
      const flags = claimed[c.file]?.[side];
      if (!m || !flags) continue;
      const [own, other] = side === "a" ? [m.src, m.dst] : [m.dst, m.src];
      for (let id = c.i; id < c.i + c.size; id++) {
        flags[id] = 1;
        const partner = own[id];
        if (partner !== undefined && partner !== -1) {
          other[partner] = -1;
          own[id] = -1;
        }
      }
    }
  };
  const move = (x: Candidate, y: Candidate): CrossEdit => ({
    from: x.file,
    to: y.file,
    whole: true,
    edit: {
      kind: "move",
      old: { start: x.tree.start(x.n), end: x.tree.end(x.n) },
      new: { start: y.tree.start(y.n), end: y.tree.end(y.n) },
      node: x.tree.kindName(x.n),
      a: x.n,
      b: y.n,
    },
    ta: x.tree,
    tb: y.tree,
  });

  // Identical subtrees.
  const byIso = new Map<number, Candidate[]>();
  for (const y of intoB) {
    const id = iso[y.file]?.b[y.i];
    if (id === undefined) continue;
    const list = byIso.get(id);
    if (list) list.push(y);
    else byIso.set(id, [y]);
  }
  const identical = (x: Candidate) => {
    const id = iso[x.file]?.a[x.i];
    if (id === undefined) return false;
    const y = byIso.get(id)?.find((y) => y.file !== x.file && !isClaimed("b", y));
    if (!y) return false;
    claim(x, y);
    edits.push(move(x, y));
    return true;
  };

  // The same declaration edited on the way: one candidate of that kind and name on each side.
  const byName = (cs: Candidate[]) => {
    const groups = new Map<string, Candidate[]>();
    for (const c of cs) {
      const name = nameOf(c.tree, c.n);
      if (name === undefined) continue;
      const key = `${c.tree.kindName(c.n)}\0${name}`;
      const list = groups.get(key);
      if (list) list.push(c);
      else groups.set(key, [c]);
    }
    return groups;
  };
  const namedA = byName(fromA);
  const namedB = byName(intoB);
  const sameName = (x: Candidate) => {
    const name = nameOf(x.tree, x.n);
    if (name === undefined) return;
    const key = `${x.tree.kindName(x.n)}\0${name}`;
    const xs = namedA.get(key)?.filter((c) => !isClaimed("a", c)) ?? [];
    const ys = namedB.get(key)?.filter((c) => !isClaimed("b", c)) ?? [];
    const [y] = ys;
    if (xs.length !== 1 || ys.length !== 1 || !y || y.file === x.file) return;
    if (Math.min(x.size, y.size) < Math.max(x.size, y.size) / 2) return;
    const ma = mappings[x.file];
    const mb = mappings[y.file];
    if (!ma || !mb) return;
    let inner: EditScript;
    try {
      // Views of the two subtrees, so the inner edits name nodes of the real trees, ancestors reachable.
      inner = editScript(match(ma.a.sub(x.n), mb.b.sub(y.n), opts));
    } catch (error) {
      if (error instanceof MatchBudgetExceeded) return;
      throw error;
    }
    claim(x, y);
    edits.push(move(x, y));
    for (const e of inner.edits)
      edits.push({
        from: x.file,
        to: y.file,
        edit: e,
        ta: inner.a,
        tb: inner.b,
      });
  };

  // Largest first, so a declaration edited on the way pairs whole before its unchanged body could pair alone.
  for (const x of fromA) if (!isClaimed("a", x) && !identical(x)) sameName(x);
  return { claimed, edits };
}

function inImport(tree: Tree, n: number): boolean {
  for (let p = n; p !== NO_NODE; p = tree.parent(p))
    if (importKinds.test(tree.kindName(p))) return true;
  return false;
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
  if (name !== undefined) return tree.count(name) === 0 ? tree.label(name) : undefined;
  const inner =
    named.find((c) => {
      const field = tree.fieldName(c);
      return field === "declaration" || field === "definition";
    }) ?? (named.length === 1 ? named[0] : undefined);
  return inner !== undefined ? nameOf(tree, inner) : undefined;
}
