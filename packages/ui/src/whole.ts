/**
 * Whole units: an added or deleted file, or a declaration inserted or deleted whole, reads as one change rather
 * than as emphasized pieces, while viewing still works atom by atom inside it.
 */
import type { SideName } from "./atoms.js";
import { type DiffFile, statusOf } from "./rows.js";

/** The file as a whole unit: the engine's `status`, else what the host's change says. */
export function wholeFileStatus(file: DiffFile): "added" | "deleted" | undefined {
  if (file.status) return file.status;
  const s = file.change && statusOf(file.change);
  return s === "added" || s === "deleted" ? s : undefined;
}

/** Where a unit starts: the 1-based line its first row shows, per fragment and side. */
export const wholeKey = (fragment: number, side: SideName, line: number) =>
  `${fragment}:${side}:${line}`;

/**
 * The lines, by `wholeKey`, that open a whole unit spanning more than one line; a rule above each sets it apart
 * from the code before it. In an added or deleted file every top node is whole, so only declarations (those with a
 * label) get one.
 */
export function wholeStarts(file: DiffFile): Set<string> {
  const out = new Set<string>();
  const fileWhole = wholeFileStatus(file) !== undefined;
  file.fragments.forEach((frag, fragment) => {
    if (frag.kind !== "diff") return;
    for (const side of ["before", "after"] as const) {
      for (const n of frag[side].nodes ?? []) {
        if (!n.whole) continue;
        if (fileWhole && n.label === undefined) continue;
        const lastLine = frag[side].startLine + n.end.line - (n.end.column === 0 ? 1 : 0);
        // A one-line declaration needs no rule of its own, even when a leading comment it takes along makes the
        // unit two lines; a run of imports would otherwise get one between every line.
        if (lastLine <= frag[side].startLine + n.start.line) continue;
        out.add(wholeKey(fragment, side, frag[side].startLine + (n.wholeStart ?? n.start).line));
      }
    }
  });
  return out;
}
