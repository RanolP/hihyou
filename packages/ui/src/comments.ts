/**
 * Comments anchored to an AST node, optionally narrowed to a character range inside it. The anchor is the
 * engine's `AnchorData`; `chars` counts the node's characters with whitespace skipped, so a word keeps its range
 * when the node is reformatted.
 */
import type { AnchorData } from "@hihyou/engine";
import {
  type AtomIndex,
  contextFragment,
  type NodeRef,
  type SideTree,
  treeOf,
} from "./atoms.js";

export type CharRange = NonNullable<AnchorData["chars"]>;

export interface ReviewNote {
  id: string;
  anchor: AnchorData;
  body: string;
}

/** The node's display text, its lines joined by "\n". */
export function nodeText(tree: SideTree, node: number): string | undefined {
  const n = tree.nodes[node];
  if (!n) return undefined;
  const out: string[] = [];
  for (let line = n.start.line; line <= n.end.line; line++) {
    const text = tree.lines[line] ?? "";
    const from = line === n.start.line ? n.start.column : 0;
    const to = line === n.end.line ? n.end.column : text.length;
    out.push(text.slice(from, to));
  }
  return out.join("\n");
}

const space = /\s/;

/** Per non-whitespace character of `text`, its offset in `text`. */
const solidOffsets = (text: string) => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++)
    if (!space.test(text[i] as string)) out.push(i);
  return out;
};

/** The words of `text`, as ranges in its whitespace-skipped characters. */
export function wordsOf(text: string): CharRange[] {
  const solid = solidOffsets(text);
  const out: CharRange[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}_$]+/gu)) {
    const start = solid.indexOf(m.index);
    out.push({ start, end: start + m[0].length });
  }
  return out;
}

/** `chars` as display offsets into `text`, `end` exclusive. */
export function displayRange(text: string, chars: CharRange): CharRange {
  const solid = solidOffsets(text);
  const start = solid[chars.start] ?? text.length;
  const last = solid[chars.end - 1];
  return { start, end: last === undefined ? start : last + 1 };
}

/** Display offsets into `text` as whitespace-skipped `chars`. */
export function charsOf(text: string, from: number, to: number): CharRange {
  const solid = solidOffsets(text);
  const count = (at: number) => solid.filter((o) => o < at).length;
  return { start: count(from), end: count(to) };
}

/** A display offset into a node's text as a line and column of its tree. */
export function linePos(tree: SideTree, node: number, offset: number) {
  const n = tree.nodes[node];
  let line = n?.start.line ?? 0;
  let column = n?.start.column ?? 0;
  let left = offset;
  for (;;) {
    const rest = (tree.lines[line]?.length ?? 0) - column;
    if (left <= rest || line >= (n?.end.line ?? 0))
      return { line, column: column + left };
    left -= rest + 1;
    line++;
    column = 0;
  }
}

/** The anchor a comment on `ref`, narrowed by `chars`, is stored under. */
export function anchorOf(
  index: AtomIndex,
  ref: NodeRef,
  chars?: CharRange,
): AnchorData | undefined {
  const path = index.files[ref.file]?.path;
  const n = treeOf(index, ref)?.nodes[ref.node];
  if (path === undefined || !n) return undefined;
  return { side: ref.side, path, nodes: [n.steps], ...(chars && { chars }) };
}

const sameSteps = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((s, i) => s === b[i]);

/** Where an anchor's first node is drawn, if anywhere: a hunk side or the file's context. */
export function refOf(
  index: AtomIndex,
  anchor: AnchorData,
): NodeRef | undefined {
  const file = index.files.findIndex((f) => f.path === anchor.path);
  const steps = anchor.nodes[0];
  if (file < 0 || !steps) return undefined;
  const trees: [number, SideTree | undefined][] = [
    ...(index.hunks[file] ?? []).map(
      (h) => [h.fragment, h[anchor.side]] as [number, SideTree],
    ),
    [
      contextFragment,
      anchor.side === "after" ? index.context[file] : undefined,
    ],
  ];
  for (const [fragment, tree] of trees) {
    const node = tree?.nodes.findIndex((n) => sameSteps(n.steps, steps)) ?? -1;
    if (node >= 0) return { file, fragment, side: anchor.side, node };
  }
  return undefined;
}

export interface CommentStore {
  all(): readonly ReviewNote[];
  add(anchor: AnchorData, body: string): ReviewNote;
  subscribe(listener: () => void): () => void;
}

/** Comments for as long as the open review's view lives, as the in-session viewed and score stores keep theirs. */
export function sessionCommentStore(): CommentStore {
  let notes: readonly ReviewNote[] = [];
  let next = 0;
  const listeners = new Set<() => void>();
  return {
    all: () => notes,
    add(anchor, body) {
      const note = { id: `c${next++}`, anchor, body };
      notes = [...notes, note];
      for (const l of listeners) l();
      return note;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
