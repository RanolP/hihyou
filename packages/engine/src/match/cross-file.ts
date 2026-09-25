import { type SyntaxNode, type SyntaxTree, syntaxTree } from "../parse/tree.js";
import { type Claimed, editScript, type RawEdit } from "./edit-script.js";
import {
  defaultMatchOptions,
  isoIds,
  type Mapping,
  MatchBudgetExceeded,
  type MatchOptions,
  match,
} from "./matcher.js";

/**
 * An edit whose `old` lies in file `from`'s base text and whose `new` in file `to`'s head text,
 * by index into the list given to `crossFileMoves`. An insert has only `to`, a delete only `from`.
 * `whole` marks the move of a declaration itself, as against the edits made inside it on the way.
 */
export type CrossEdit = {
  edit: RawEdit;
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
  const iso = mappings.map(
    (m) => m && { a: isoIds(m.a, intern), b: isoIds(m.b, intern) },
  );
  const claimed = mappings.map(
    (m) =>
      m && {
        a: new Uint8Array(m.a.nodes.length),
        b: new Uint8Array(m.b.nodes.length),
      },
  );
  const edits: CrossEdit[] = [];

  type Candidate = { file: number; n: SyntaxNode };
  const candidates = (side: "a" | "b"): Candidate[] =>
    mappings
      .flatMap((m, file) => {
        if (!m) return [];
        const table = side === "a" ? m.src : m.dst;
        return m[side].nodes
          .filter(
            (n) =>
              n.parent &&
              n.named &&
              n.size >= minMoveSize &&
              table[n.id] === -1 &&
              !inImport(n),
          )
          .map((n) => ({ file, n }));
      })
      .sort((p, q) => q.n.size - p.n.size);
  const fromA = candidates("a");
  const intoB = candidates("b");
  const isClaimed = (side: "a" | "b", c: Candidate) =>
    claimed[c.file]?.[side][c.n.id] === 1;

  const claim = (x: Candidate, y: Candidate) => {
    for (const [side, c] of [
      ["a", x],
      ["b", y],
    ] as const) {
      const m = mappings[c.file];
      const flags = claimed[c.file]?.[side];
      if (!m || !flags) continue;
      const [own, other] = side === "a" ? [m.src, m.dst] : [m.dst, m.src];
      for (let id = c.n.id; id < c.n.id + c.n.size; id++) {
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
      old: { start: x.n.start, end: x.n.end },
      new: { start: y.n.start, end: y.n.end },
      node: x.n.kind,
      a: x.n,
      b: y.n,
    },
  });

  // Identical subtrees.
  const byIso = new Map<number, Candidate[]>();
  for (const y of intoB) {
    const id = iso[y.file]?.b[y.n.id];
    if (id === undefined) continue;
    const list = byIso.get(id);
    if (list) list.push(y);
    else byIso.set(id, [y]);
  }
  const identical = (x: Candidate) => {
    const id = iso[x.file]?.a[x.n.id];
    if (id === undefined) return false;
    const y = byIso
      .get(id)
      ?.find((y) => y.file !== x.file && !isClaimed("b", y));
    if (!y) return false;
    claim(x, y);
    edits.push(move(x, y));
    return true;
  };

  // The same declaration edited on the way: one candidate of that kind and name on each side.
  const byName = (cs: Candidate[]) => {
    const groups = new Map<string, Candidate[]>();
    for (const c of cs) {
      const name = nameOf(c.n);
      if (name === undefined) continue;
      const key = `${c.n.kind}\0${name}`;
      const list = groups.get(key);
      if (list) list.push(c);
      else groups.set(key, [c]);
    }
    return groups;
  };
  const namedA = byName(fromA);
  const namedB = byName(intoB);
  const sameName = (x: Candidate) => {
    const name = nameOf(x.n);
    if (name === undefined) return;
    const key = `${x.n.kind}\0${name}`;
    const xs = namedA.get(key)?.filter((c) => !isClaimed("a", c)) ?? [];
    const ys = namedB.get(key)?.filter((c) => !isClaimed("b", c)) ?? [];
    const [y] = ys;
    if (xs.length !== 1 || ys.length !== 1 || !y || y.file === x.file) return;
    if (Math.min(x.n.size, y.n.size) < Math.max(x.n.size, y.n.size) / 2) return;
    const ma = mappings[x.file];
    const mb = mappings[y.file];
    if (!ma || !mb) return;
    let inner: RawEdit[];
    try {
      inner = editScript(match(subtree(ma.a, x.n), subtree(mb.b, y.n), opts));
    } catch (error) {
      if (error instanceof MatchBudgetExceeded) return;
      throw error;
    }
    claim(x, y);
    edits.push(move(x, y));
    // The inner script ran on copies; point its nodes back at the real trees so their ancestors stay reachable.
    const realA = (n: SyntaxNode) => ma.a.node(x.n.id + n.id);
    const realB = (n: SyntaxNode) => mb.b.node(y.n.id + n.id);
    for (const e of inner) {
      const edit: RawEdit = { ...e };
      if ("a" in edit && edit.a) edit.a = realA(edit.a);
      if ("b" in edit && edit.b) edit.b = realB(edit.b);
      edits.push({ from: x.file, to: y.file, edit });
    }
  };

  // Largest first, so a declaration edited on the way pairs whole before its unchanged body could pair alone.
  for (const x of fromA) if (!isClaimed("a", x) && !identical(x)) sameName(x);
  return { claimed, edits };
}

function inImport(n: SyntaxNode): boolean {
  for (let p: SyntaxNode | undefined = n; p; p = p.parent)
    if (importKinds.test(p.kind)) return true;
  return false;
}

/**
 * The name a declaration introduces: its `name` field, through an `export` (default or not), a Python
 * decorator, or a single `const x = ...`.
 */
export function nameOf(n: SyntaxNode): string | undefined {
  const named = n.children.filter((c) => c.named);
  const name = named.find((c) => c.field === "name");
  if (name) return name.children.length === 0 ? name.label : undefined;
  const inner =
    named.find((c) => c.field === "declaration" || c.field === "definition") ??
    (named.length === 1 ? named[0] : undefined);
  return inner ? nameOf(inner) : undefined;
}

/** A copy of `root`'s subtree as a tree of its own, ids rebased to 0 and offsets kept, so its spans still index the file's text. */
function subtree(tree: SyntaxTree, root: SyntaxNode): SyntaxTree {
  const nodes: SyntaxNode[] = [];
  // Preorder: a node's parent is always copied before it.
  for (let id = root.id; id < root.id + root.size; id++) {
    const n = tree.node(id);
    const parent =
      id === root.id || !n.parent ? undefined : nodes[n.parent.id - root.id];
    const c: SyntaxNode = { ...n, id: id - root.id, parent, children: [] };
    nodes.push(c);
    parent?.children.push(c);
  }
  return syntaxTree(nodes, 0);
}
