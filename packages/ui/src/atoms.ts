import { atomKey, type NodeOutline, type Span } from "@hihyou/engine";
import { type DiffFile, splitLines } from "./rows.js";
import type {
  KeyOf,
  Score,
  ScoreStore,
  ViewedStore,
  ViewedSubject,
} from "./viewed.js";

export type { NodeOutline };

export type SideName = "before" | "after";

export interface NodeRef {
  file: number;
  fragment: number;
  side: SideName;
  node: number;
}

/** What a selection addresses; a hunk is one `diff` fragment. */
export type Target =
  | ({ kind: "node" } & NodeRef)
  | { kind: "hunk"; file: number; fragment: number }
  | { kind: "file"; file: number };

export interface SideTree {
  nodes: readonly NodeOutline[];
  roots: number[];
  children: number[][];
  /** Per node, the atoms (indices into `AtomIndex.atoms`) at or beneath it. */
  atoms: number[][];
  /** The display text of each line the nodes' `start` and `end` count, so a comment can narrow to a word. */
  lines: string[];
}

/** The fragment number a file's context nodes carry: its unchanged and revealed lines, which hold no hunk. */
export const contextFragment = -2;

/** A changed line no atom node covers, and the row atom that stands for it. */
export interface RowAtom {
  side: SideName;
  line: number;
  atom: number;
}

export interface Hunk {
  file: number;
  fragment: number;
  before: SideTree;
  after: SideTree;
  atoms: number[];
  rows: RowAtom[];
}

export interface Atom {
  id: string;
  occurrences: NodeRef[];
}

export interface AtomIndex {
  files: readonly DiffFile[];
  /** In document order of their first occurrence. */
  atoms: Atom[];
  /** Per file, its hunks in fragment order. */
  hunks: Hunk[][];
  /** Per file, its atoms. */
  fileAtoms: number[][];
  /**
   * Where j/k land, in document order: every atom node, except that an atom seen on both sides of one hunk (an
   * update) stops once, on its first side. A move's halves in two files stop once in each.
   */
  stops: NodeRef[];
  /**
   * Per file, the after side's nodes in its unchanged and revealed context, at `contextFragment`: lines count
   * from the file's first line, so every piece of context shares one tree. They hold no atom.
   */
  context: (SideTree | undefined)[];
}

const textLines = (spans: readonly Span[]) =>
  splitLines(spans).map((l) => l.map((s) => s.text).join(""));

function contextTree(file: DiffFile): SideTree | undefined {
  const pieces = [
    ...file.fragments.flatMap((f) => (f.kind === "unchanged" ? [f] : [])),
    ...Object.values(file.revealed ?? {}).flatMap((r) => [
      ...r.top,
      ...r.bottom,
    ]),
  ];
  const nodes: NodeOutline[] = [];
  const lines: string[] = [];
  for (const p of pieces) {
    const base = nodes.length;
    const l0 = p.lines.after - 1;
    textLines(p.spans).forEach((text, i) => {
      lines[l0 + i] = text;
    });
    for (const n of p.nodes ?? [])
      nodes.push({
        ...n,
        parent: n.parent < 0 ? -1 : n.parent + base,
        start: { line: n.start.line + l0, column: n.start.column },
        end: { line: n.end.line + l0, column: n.end.column },
      });
  }
  if (nodes.length === 0) return undefined;
  const roots: number[] = [];
  const children: number[][] = nodes.map(() => []);
  nodes.forEach((n, i) => {
    if (n.parent < 0) roots.push(i);
    else children[n.parent]?.push(i);
  });
  return { nodes, roots, children, atoms: nodes.map(() => []), lines };
}

const sideNames: readonly SideName[] = ["before", "after"];

export function atomIndex(files: readonly DiffFile[]): AtomIndex {
  const atoms: Atom[] = [];
  const ids = new Map<string, number>();
  const hunks: Hunk[][] = [];
  const fileAtoms: number[][] = [];
  const stops: NodeRef[] = [];
  const atom = (id: string) => {
    let a = ids.get(id);
    if (a === undefined) {
      a = atoms.length;
      ids.set(id, a);
      atoms.push({ id, occurrences: [] });
    }
    return a;
  };
  files.forEach((file, f) => {
    const mine: Hunk[] = [];
    const inFile = new Set<number>();
    file.fragments.forEach((frag, fr) => {
      if (frag.kind !== "diff") return;
      const inHunk = new Set<number>();
      const tree = (side: SideName): SideTree => {
        const nodes = frag[side].nodes ?? [];
        const roots: number[] = [];
        const children: number[][] = nodes.map(() => []);
        const own = nodes.map((n, i) => {
          if (n.parent < 0) roots.push(i);
          else children[n.parent]?.push(i);
          if (n.atom === undefined) return [];
          const a = atom(n.atom);
          const ref: NodeRef = { file: f, fragment: fr, side, node: i };
          atoms[a]?.occurrences.push(ref);
          if (!inHunk.has(a)) stops.push(ref);
          inHunk.add(a);
          inFile.add(a);
          return [a];
        });
        // Children come after their parent, so a reverse sweep sees every child's atoms before the parent's.
        const beneath = own.map((a) => new Set(a));
        for (let i = nodes.length - 1; i >= 0; i--) {
          const p = nodes[i]?.parent ?? -1;
          if (p >= 0) for (const a of beneath[i] ?? []) beneath[p]?.add(a);
        }
        return {
          nodes,
          roots,
          children,
          atoms: beneath.map((s) => [...s]),
          lines: textLines(frag[side].spans),
        };
      };
      const [before, after] = sideNames.map(tree) as [SideTree, SideTree];
      const rows: RowAtom[] = [];
      for (const side of sideNames) {
        const t = side === "before" ? before : after;
        const lines = splitLines(frag[side].spans);
        const covers = (n: NodeOutline, line: number) =>
          n.start.line <= line &&
          (n.end.line > line || (n.end.line === line && n.end.column > 0));
        t.lines.forEach((text, line) => {
          const owned = t.nodes.some(
            (n) => n.atom !== undefined && covers(n, line),
          );
          if (
            owned ||
            !lines[line]?.some((span) => span.changed && span.text.trim() !== "")
          )
            return;
          const a = atom(
            `row:${atomKey({
              path: file.path,
              ancestors: [],
              [side]: text,
            })}`,
          );
          inHunk.add(a);
          inFile.add(a);
          rows.push({ side, line, atom: a });
          // A node over the row holds it too: marking the node marks the row, and the node reads viewed only with it.
          t.nodes.forEach((n, i) => {
            const held = t.atoms[i];
            if (held && covers(n, line) && !held.includes(a)) held.push(a);
          });
        });
      }
      mine.push({
        file: f,
        fragment: fr,
        before,
        after,
        atoms: [...inHunk],
        rows,
      });
    });
    hunks.push(mine);
    fileAtoms.push([...inFile]);
  });
  return {
    files,
    atoms,
    hunks,
    fileAtoms,
    stops,
    context: files.map(contextTree),
  };
}

export function hunkOf(
  index: AtomIndex,
  file: number,
  fragment: number,
): Hunk | undefined {
  return index.hunks[file]?.find((h) => h.fragment === fragment);
}

export function treeOf(
  index: AtomIndex,
  ref: Omit<NodeRef, "node">,
): SideTree | undefined {
  if (ref.fragment === contextFragment)
    return ref.side === "after" ? index.context[ref.file] : undefined;
  return hunkOf(index, ref.file, ref.fragment)?.[ref.side];
}

/** The atoms beneath a target, as indices into `index.atoms`. */
export function atomsOf(index: AtomIndex, t: Target): number[] {
  if (t.kind === "file") return index.fileAtoms[t.file] ?? [];
  if (t.kind === "hunk") return hunkOf(index, t.file, t.fragment)?.atoms ?? [];
  return treeOf(index, t)?.atoms[t.node] ?? [];
}

export const atomSubject = (atom: string) => ({ kind: "atom", atom }) as const;

/** Whether one atom (by its engine id) is viewed in `store`. */
export const atomViewed =
  (store: ViewedStore, keyOf: KeyOf) =>
  (atom: string): boolean =>
    store.get(keyOf(atomSubject(atom)));

/** Viewed when every atom beneath the target is; `undefined` when it has none, so it cannot be marked. */
export function viewedOf(
  index: AtomIndex,
  t: Target,
  isViewed: (atom: string) => boolean,
): boolean | undefined {
  const atoms = atomsOf(index, t);
  if (atoms.length === 0) return undefined;
  return atoms.every((a) => isViewed(index.atoms[a]?.id ?? ""));
}

/** A line on one side of a hunk. */
export type LineRef = Omit<NodeRef, "node"> & { line: number };

/**
 * What draws as read: each outermost node whose atoms are all viewed, over its whole range, and each viewed row
 * atom's line. A node's range also holds matched code with no atom of its own (the names an import kept), which
 * would otherwise keep the line's diff colour after `v` marks the node.
 *
 * `lines` judges changed lines whole, so a row can drop the line colour once nothing on it is left to read: a
 * line holding atoms (a node's own or its row atom) is read when all of them are. A line holding none (a
 * reflowed `import {`, a declaration's closing `}`) is read when a read node covers it, and otherwise says
 * nothing, so it never keeps another line's row coloured.
 */
export const readParts = (
  index: AtomIndex,
  isViewed: (atom: string) => boolean,
): {
  nodes: NodeRef[];
  rows: LineRef[];
  lines: (LineRef & { read: boolean })[];
} => {
  const nodes: NodeRef[] = [];
  const rows: LineRef[] = [];
  const lines: (LineRef & { read: boolean })[] = [];
  const read = (a: number) => isViewed(index.atoms[a]?.id ?? "");
  /** The lines a node draws on; one ending at column 0 stops on the line before. */
  const spanned = (n: NodeOutline) => {
    const last = n.end.column > 0 ? n.end.line : n.end.line - 1;
    const out: number[] = [];
    for (let l = n.start.line; l <= last; l++) out.push(l);
    return out;
  };
  for (const hunk of index.hunks.flat())
    for (const side of sideNames) {
      const t = hunk[side];
      const at = { file: hunk.file, fragment: hunk.fragment, side };
      const readNodes: number[] = [];
      const visit = (node: number) => {
        const atoms = t.atoms[node] ?? [];
        if (atoms.length > 0 && atoms.every(read)) {
          nodes.push({ ...at, node });
          readNodes.push(node);
        } else for (const c of t.children[node] ?? []) visit(c);
      };
      t.roots.forEach(visit);
      // Per line holding an atom, whether every atom on it is read so far.
      const atomsRead = new Map<number, boolean>();
      for (const n of t.nodes)
        if (n.atom !== undefined) {
          const r = isViewed(n.atom);
          for (const l of spanned(n))
            atomsRead.set(l, (atomsRead.get(l) ?? true) && r);
        }
      for (const r of hunk.rows) {
        if (r.side !== side) continue;
        const v = read(r.atom);
        if (v) rows.push({ ...at, line: r.line });
        atomsRead.set(r.line, (atomsRead.get(r.line) ?? true) && v);
      }
      const coveredRead = new Set(
        readNodes.flatMap((node) => {
          const n = t.nodes[node];
          return n ? spanned(n) : [];
        }),
      );
      for (const [line, v] of atomsRead) lines.push({ ...at, line, read: v });
      for (const line of coveredRead)
        if (!atomsRead.has(line)) lines.push({ ...at, line, read: true });
    }
  return { nodes, rows, lines };
};

/** Writes every atom beneath the target; a move's atom is shared, so its other file reads it too. */
export function setViewed(
  index: AtomIndex,
  t: Target,
  viewed: boolean,
  store: ViewedStore,
  keyOf: KeyOf,
): void {
  writeAtoms(
    atomsOf(index, t).map((a) => index.atoms[a]?.id ?? ""),
    viewed,
    store,
    keyOf,
  );
}

/** The subject a node's score is filed under; `undefined` for a ref that names no node. */
export function nodeSubject(
  index: AtomIndex,
  ref: NodeRef,
): ViewedSubject | undefined {
  const path = index.files[ref.file]?.path;
  const n = treeOf(index, ref)?.nodes[ref.node];
  if (path === undefined || !n) return undefined;
  return { kind: "node", path, side: ref.side, steps: n.steps, hash: n.hash };
}

export const nodeScore =
  (index: AtomIndex, store: ScoreStore, keyOf: KeyOf) =>
  (ref: NodeRef): Score | null => {
    const s = nodeSubject(index, ref);
    return s ? store.get(keyOf(s)) : null;
  };

export function writeScores(
  index: AtomIndex,
  nodes: readonly NodeRef[],
  score: Score | null,
  store: ScoreStore,
  keyOf: KeyOf,
): void {
  store.setMany(
    nodes.flatMap((r) => {
      const s = nodeSubject(index, r);
      return s ? [keyOf(s)] : [];
    }),
    score,
  );
}

export function writeAtoms(
  atoms: readonly string[],
  viewed: boolean,
  store: ViewedStore,
  keyOf: KeyOf,
): void {
  store.setMany(
    atoms.map((atom) => keyOf(atomSubject(atom))),
    viewed,
  );
}
