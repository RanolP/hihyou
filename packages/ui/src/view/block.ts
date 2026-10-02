import { createRenderEffect, type JSX } from "solid-js";
import type { SideName } from "../rows.js";
import type { DrawContext } from "./context.js";
import type { PairView } from "./pair.jsx";

/** One table being drawn: its file, and per side the move whose block the rows being drawn are inside. */
export interface TableDraw {
  index: number;
  openPair: Partial<Record<SideName, PairView>>;
  /** Draws the other file's half of an expanded cross-file move into `out`, under the block. */
  pairRows(view: PairView, out: JSX.Element[]): void;
}

/**
 * Marks the cells of `side` that lie inside a move: dimmed while viewed, and a cross-file move's block expands
 * on a click like its label, except on its code text, where a click selects a node. The expansion goes under the
 * block's last line, so the returned step runs once the row itself is out.
 */
export function blockCells(
  ctx: DrawContext,
  table: TableDraw,
  side: SideName,
  cells: readonly Element[],
  moved: { last: boolean } | undefined,
  out: JSX.Element[],
): () => void {
  const view = table.openPair[side];
  if (!moved || !view) return () => {};
  for (const c of cells) {
    createRenderEffect(() =>
      c.classList.toggle("hh-viewed", ctx.pairs.isViewed(view)),
    );
    if (view.pair.crossFile) {
      c.classList.add("hh-pair-toggle");
      ctx.actions.set(c, () => ctx.pairs.toggle(view));
    }
  }
  if (!moved.last) return () => {};
  delete table.openPair[side];
  return () => {
    if (view.pair.crossFile && ctx.pairs.isExpanded(view.id))
      table.pairRows(view, out);
  };
}
