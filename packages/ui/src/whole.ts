/**
 * Whole units: an added or deleted file, or a declaration inserted or deleted whole, reads as one change ("added
 * function extra") rather than as emphasized pieces, while viewing still works atom by atom inside it.
 */
import type { NodeOutline } from "@hihyou/engine";
import { type AtomIndex, atomsOf, type NodeRef, type SideName, type Target } from "./atoms.js";
import { type DiffFile, statusOf } from "./rows.js";

/** The file as a whole unit: the engine's `status`, else what the host's change says. */
export function wholeFileStatus(file: DiffFile): "added" | "deleted" | undefined {
  if (file.status) return file.status;
  const s = file.change && statusOf(file.change);
  return s === "added" || s === "deleted" ? s : undefined;
}

/** "added function extra"; a unit with no label is a kind-less "added block". */
export const wholeText = (n: NodeOutline): string | undefined =>
  n.whole && `${n.whole} ${n.label ?? "block"}`;

export interface WholeHeader {
  ref: NodeRef;
  text: string;
  whole: "added" | "deleted";
}

/** Where a header row goes: the 1-based line its unit starts on, per fragment and side. */
export const wholeKey = (fragment: number, side: SideName, line: number) =>
  `${fragment}:${side}:${line}`;

/**
 * The header rows of one file, by `wholeKey`. In an added or deleted file every top node is whole, so only the
 * declarations (those with a label) get a header; the file badge already says the rest.
 */
export function wholeHeaders(file: DiffFile, index: number): Map<string, WholeHeader> {
  const out = new Map<string, WholeHeader>();
  const fileWhole = wholeFileStatus(file) !== undefined;
  file.fragments.forEach((frag, fragment) => {
    if (frag.kind !== "diff") return;
    for (const side of ["before", "after"] as const) {
      (frag[side].nodes ?? []).forEach((n, node) => {
        const text = wholeText(n);
        if (!text || !n.whole) return;
        if (fileWhole && n.label === undefined) return;
        const key = wholeKey(fragment, side, frag[side].startLine + n.start.line);
        if (out.has(key)) return;
        out.set(key, { ref: { file: index, fragment, side, node }, text, whole: n.whole });
      });
    }
  });
  return out;
}

/** "viewed" when every atom beneath is, "partial" when some are; `undefined` when it has no atom. */
export function viewState(
  index: AtomIndex,
  t: Target,
  isViewed: (atom: string) => boolean,
): "viewed" | "partial" | "unviewed" | undefined {
  const atoms = atomsOf(index, t);
  if (atoms.length === 0) return undefined;
  const n = atoms.filter((a) => isViewed(index.atoms[a]?.id ?? "")).length;
  return n === atoms.length ? "viewed" : n > 0 ? "partial" : "unviewed";
}
