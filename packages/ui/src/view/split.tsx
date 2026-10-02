import type { JSX } from "solid-js";
import type { Cell, Row, SideName } from "../rows.js";
import { blockCells, type TableDraw } from "./block.js";
import type { DrawContext } from "./context.js";
import { ElidedRow } from "./elided.jsx";
import { MoveLabel } from "./pair.jsx";
import { SpanNodes } from "./spans.jsx";

const markers: Record<SideName, string> = { before: "- ", after: "+ " };

/** One side's line number and code cells of a split row. */
export function sideCells(
  ctx: DrawContext,
  side: SideName,
  cell: Cell | undefined,
  changed: boolean,
  moved?: { last: boolean },
  at?: { file: number; fragment: number },
): HTMLTableCellElement[] {
  if (!cell)
    return [
      (<td class="hh-num hh-empty" />) as HTMLTableCellElement,
      (<td class="hh-code hh-empty" />) as HTMLTableCellElement,
    ];
  const kind = moved
    ? ` hh-moved${moved.last ? " hh-moved-last" : ""}`
    : changed
      ? side === "before"
        ? " hh-removed"
        : " hh-added"
      : "";
  const place = at && ctx.placer.lineCursor(at.file, at.fragment, side, cell.line);
  return [
    (<td class={`hh-num${kind}`}>{String(cell.line)}</td>) as HTMLTableCellElement,
    (
      <td class={`hh-code${moved ? kind : ""}`}>
        {changed && (
          <span class="hh-sr">{moved ? "moved " : markers[side]}</span>
        )}
        <SpanNodes spans={cell.spans} side={side} place={place} />
      </td>
    ) as HTMLTableCellElement,
  ];
}

function MoveRow(props: {
  file: number;
  row: Row & { kind: "diff" };
}): JSX.Element {
  return (
    <tr class="hh-move">
      {(["before", "after"] as const).map((side) => {
        const move = props.row.move?.[side];
        return (
          <td class={`hh-move-cell${move ? " hh-moved" : ""}`} colSpan={2}>
            {move && (
              <MoveLabel
                file={props.file}
                fragment={props.row.fragment}
                side={side}
                move={move}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

/** A split row: each side's number and code side by side, a move's label row above it. */
export function splitRow(
  ctx: DrawContext,
  table: TableDraw,
  row: Row,
  out: JSX.Element[],
): void {
  const { index } = table;
  if (row.kind === "elided") {
    out.push(<ElidedRow path={ctx.files()[index]?.path ?? ""} gap={row} />);
    return;
  }
  const changed = row.kind === "diff";
  const moved = row.kind === "diff" ? row.moved : undefined;
  const at =
    row.kind === "diff" ? { file: index, fragment: row.fragment } : undefined;
  const before = sideCells(ctx, "before", row.before, changed, moved?.before, at);
  const after = sideCells(ctx, "after", row.after, changed, moved?.after, at);
  const tr = (
    <tr class="hh-line">
      {before}
      {after}
    </tr>
  ) as HTMLTableRowElement;
  const steps: (() => void)[] = [];
  if (row.kind === "diff") {
    if (row.before) tr.dataset["before"] = String(row.before.line);
    if (row.after) tr.dataset["after"] = String(row.after.line);
    if (row.move) {
      const label = (<MoveRow file={index} row={row} />) as HTMLTableRowElement;
      for (const [i, side] of (["before", "after"] as const).entries()) {
        const move = row.move[side];
        const view = move && ctx.pairs.of(index, row.fragment, side, move);
        const td = label.children[i];
        if (view && td) ctx.pairOfElement.set(td, view);
      }
      out.push(label);
    }
    ctx.remember(index, row.fragment, tr);
    for (const side of ["before", "after"] as const) {
      const move = row.move?.[side];
      const view = move && ctx.pairs.of(index, row.fragment, side, move);
      if (view) table.openPair[side] = view;
      const own = side === "before" ? before : after;
      steps.push(blockCells(ctx, table, side, own, row.moved?.[side], out));
    }
  }
  out.push(tr);
  for (const step of steps) step();
}
