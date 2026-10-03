import type { FileDiff, NodeOutline } from "@hihyou/engine";
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
}

export interface Hunk {
  file: number;
  fragment: number;
  before: SideTree;
  after: SideTree;
  atoms: number[];
}

export interface Atom {
  id: string;
  occurrences: NodeRef[];
}

export interface AtomIndex {
  files: readonly FileDiff[];
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
}

const sideNames: readonly SideName[] = ["before", "after"];

export function atomIndex(files: readonly FileDiff[]): AtomIndex {
  const atoms: Atom[] = [];
  const ids = new Map<string, number>();
  const hunks: Hunk[][] = [];
  const fileAtoms: number[][] = [];
  const stops: NodeRef[] = [];
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
          let a = ids.get(n.atom);
          if (a === undefined) {
            a = atoms.length;
            ids.set(n.atom, a);
            atoms.push({ id: n.atom, occurrences: [] });
          }
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
        return { nodes, roots, children, atoms: beneath.map((s) => [...s]) };
      };
      const [before, after] = sideNames.map(tree) as [SideTree, SideTree];
      mine.push({ file: f, fragment: fr, before, after, atoms: [...inHunk] });
    });
    hunks.push(mine);
    fileAtoms.push([...inFile]);
  });
  return { files, atoms, hunks, fileAtoms, stops };
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
