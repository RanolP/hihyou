import type { LinePair } from "@hihyou/engine";
import type { ReviewSource } from "./review.js";
import { type DiffFile, gapOf, lineCount, type Revealed } from "./rows.js";

/** An `elided` fragment the reviewer asked to see more of. */
export interface ElidedRef {
  /** Index into `FileDiff.fragments`. */
  fragment: number;
  /** The fragment's own `lines`, so the host can tell it still holds the same run. */
  lines: LinePair;
}

/** `down` reveals below the code above the gap, `up` above the code below it, `all` the whole gap. */
export type ExpandDirection = "up" | "down" | "all";

/** Lines one expander click reveals, as on GitHub. */
export const expandStep = 20;

/**
 * `file` with more of the elided run `ref` names revealed, from the edge `direction` grows: its `revealed`
 * entry gains the lines `fetch` returns. Undefined when the fragment is no longer that run (the files were
 * refreshed in the meantime) or nothing is left to reveal from that edge.
 */
export async function revealElided(
  file: DiffFile,
  ref: ElidedRef,
  direction: ExpandDirection,
  fetch: ReviewSource["expand"],
): Promise<DiffFile | undefined> {
  const gap = gapOf(file, ref.fragment);
  if (
    !gap ||
    gap.origin.before !== ref.lines.before ||
    gap.origin.after !== ref.lines.after ||
    gap.count === 0
  )
    return undefined;
  const { count } = gap;
  let edge: "top" | "bottom" = "top";
  let lines: LinePair = gap.lines;
  let ask: number | undefined;
  if (direction === "all") ask = count;
  else {
    ask = Math.min(expandStep, count ?? expandStep);
    if (direction === "up") {
      // A run to the end of the file has no code below it to grow up from.
      if (count === undefined) return undefined;
      edge = "bottom";
      lines = {
        before: lines.before + count - ask,
        after: lines.after + count - ask,
      };
    }
  }
  let unchanged = await fetch(file.path, lines, ask);
  // The engine refuses a count past the end of the file, and only a run to the end has no known count.
  if (!unchanged && gap.atEnd && ask !== undefined)
    unchanged = await fetch(file.path, lines);
  if (!unchanged) return undefined;
  const prev = file.revealed?.[ref.fragment] ?? { top: [], bottom: [] };
  const next: Revealed = {
    top: edge === "top" ? [...prev.top, unchanged] : prev.top,
    bottom: edge === "bottom" ? [unchanged, ...prev.bottom] : prev.bottom,
  };
  if (
    prev.exhausted ||
    (gap.atEnd && (ask === undefined || lineCount(unchanged) < ask))
  )
    next.exhausted = true;
  return { ...file, revealed: { ...file.revealed, [ref.fragment]: next } };
}

/** `file` with the run `ref` names folded back to its original gap; no lines need fetching again. */
export function collapseElided(file: DiffFile, ref: ElidedRef): DiffFile {
  const gap = gapOf(file, ref.fragment);
  if (
    !gap ||
    gap.origin.before !== ref.lines.before ||
    gap.origin.after !== ref.lines.after ||
    !file.revealed
  )
    return file;
  const { [ref.fragment]: _, ...rest } = file.revealed;
  return { ...file, revealed: rest };
}
