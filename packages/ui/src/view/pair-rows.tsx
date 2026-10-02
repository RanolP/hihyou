import type { JSX } from "solid-js";
import { type PairHalf, pairUnifiedRows } from "../moves.js";
import type { TableDraw } from "./block.js";
import type { DrawContext } from "./context.js";
import type { PairView } from "./pair.jsx";
import { unifiedRow } from "./unified.jsx";

/** The other file's half of an expanded cross-file move, read in place under the block. */
export function pairRows(
  ctx: DrawContext,
  table: TableDraw,
  view: PairView,
  out: JSX.Element[],
): void {
  const { pair } = view;
  const named = (h: PairHalf | undefined) =>
    h
      ? `${h.path}:${h.first}${h.last > h.first ? `–${h.last}` : ""}`
      : `${pair.counterpartPath} (not loaded)`;
  const other = view.side === "before" ? pair.after : pair.before;
  // Decided once per draw: an expression inside the JSX would track `files` on its own.
  const action = other ? (
      [
        " ",
        <button
          type="button"
          class="hh-button"
          on:click={() => ctx.jump(other.ref)}
        >
          {`Go to ${other.path}:${other.first}`}
        </button>,
      ]
    ) : ctx.files().some((f) => f.path === pair.counterpartPath) ? (
      [
        " ",
        <button
          type="button"
          class="hh-button"
          on:click={() => ctx.openFile(pair.counterpartPath)}
        >
          {`Open ${pair.counterpartPath}`}
        </button>,
      ]
    ) : null;
  const head = (
    <tr class="hh-pair-head">
      <td class="hh-pair-cell" colSpan={3}>
        <span>{`Moved from ${named(pair.before)} to ${named(pair.after)}`}</span>
        {action}
      </td>
    </tr>
  ) as HTMLTableRowElement;
  ctx.pairOfElement.set(head, view);
  out.push(head);
  const rows: JSX.Element[] = [];
  const inner: TableDraw = { ...table, openPair: {} };
  ctx.placer.inPair(
    { before: pair.before?.ref, after: pair.after?.ref },
    pair.before?.cells ?? [],
    () => {
      for (const row of pairUnifiedRows(pair)) unifiedRow(ctx, inner, row, rows);
    },
  );
  for (const tr of rows) {
    if (!(tr instanceof Element)) continue;
    tr.classList.add("hh-pair-row");
    ctx.pairOfElement.set(tr, view);
    out.push(tr);
  }
}
