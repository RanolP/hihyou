import type { JSX } from "solid-js";
import type { Point } from "../modal.js";
import type { MergedSpan, SideName, UnifiedRow } from "../rows.js";
import { blockCells, type TableDraw } from "./block.js";
import type { DrawContext } from "./context.js";
import { ElidedRow } from "./elided.jsx";
import { MoveLabel } from "./pair.jsx";
import { SpanNodes } from "./spans.jsx";

const signs: Record<SideName, string> = { before: "-", after: "+" };

const Num = (props: { line: number | undefined; kind?: string }) => (
  <td class={`hh-num${props.kind ?? ""}`}>
    {props.line === undefined ? "" : String(props.line)}
  </td>
);

/** A merged row's code: shared text reads on both sides, a side's changed text on that side alone. */
function mergedCode(
  ctx: DrawContext,
  index: number,
  row: UnifiedRow & { kind: "merged" },
): JSX.Element {
  const { placer } = ctx;
  const { fragment } = row;
  const afterAt =
    row.after === undefined
      ? undefined
      : placer.lineCursor(index, fragment, "after", row.after);
  // A before line deleted whole keeps a row of its own, drawn in its own order.
  const wholeAt =
    row.after === undefined && row.before !== undefined
      ? placer.lineCursor(index, fragment, "before", row.before)
      : undefined;
  // Shared text is cut where its before copy breaks off, and each piece placed on both sides.
  const shared = new Map<MergedSpan, Point | undefined>();
  const spans = wholeAt
    ? row.spans
    : row.spans.flatMap((span) => {
        if (span.changed) return [span];
        return placer.shareBefore(index, fragment, span).map((cut) => {
          shared.set(cut.span, cut.before);
          return cut.span;
        });
      });
  return (
    <SpanNodes
      spans={spans}
      side="after"
      place={(span) => {
        if (wholeAt) {
          if (span.changed)
            placer.takeBefore(index, fragment, span.text, row.before);
          return wholeAt(span);
        }
        if (span.side === "before")
          return placer.takeBefore(index, fragment, span.text);
        const after = afterAt?.(span);
        const before = shared.get(span);
        return [after, before].filter((p) => p !== undefined);
      }}
    />
  );
}

/** Both line numbers, then one code cell whose sign column says which side a lone line belongs to. */
export function unifiedRow(
  ctx: DrawContext,
  table: TableDraw,
  row: UnifiedRow,
  out: JSX.Element[],
): void {
  const { index } = table;
  if (row.kind === "elided") {
    out.push(<ElidedRow path={ctx.files()[index]?.path ?? ""} gap={row} />);
    return;
  }
  let tr: HTMLTableRowElement;
  switch (row.kind) {
    case "unchanged":
      tr = (
        <tr class="hh-line">
          <Num line={row.before.line} />
          <Num line={row.after.line} />
          <td class="hh-code">
            <span class="hh-sign" />
            <SpanNodes spans={row.after.spans} side="after" />
          </td>
        </tr>
      ) as HTMLTableRowElement;
      break;
    case "merged": {
      // A side's bar marks a row holding that side's changed text; a row of reflowed text alone has none.
      const has = (s: SideName) =>
        row.spans.some((span) => span.changed && span.side === s);
      const code = mergedCode(ctx, index, row);
      tr = (
        <tr class="hh-line">
          <Num line={row.before} kind={has("before") ? " hh-removed" : ""} />
          <Num line={row.after} kind={has("after") ? " hh-added" : ""} />
          <td class="hh-code">
            <span class="hh-sign">
              {row.after === undefined ? signs.before : ""}
            </span>
            {(has("before") || has("after")) && (
              <span class="hh-sr">changed </span>
            )}
            {code}
          </td>
        </tr>
      ) as HTMLTableRowElement;
      ctx.remember(index, row.fragment, tr);
      break;
    }
    case "line": {
      const { side, cell, moved } = row;
      const last = moved?.last ? " hh-moved-last" : "";
      const edge = moved
        ? ` hh-moved${last}`
        : side === "before"
          ? " hh-removed"
          : " hh-added";
      const line = (s: SideName) => (s === side ? cell.line : undefined);
      if (row.move) {
        const view = ctx.pairs.of(index, row.fragment, side, row.move);
        const td = (
          <td class="hh-move-cell hh-moved" colSpan={3}>
            <MoveLabel
              file={index}
              fragment={row.fragment}
              side={side}
              move={row.move}
            />
          </td>
        ) as HTMLTableCellElement;
        out.push(<tr class="hh-move">{td}</tr>);
        if (view) {
          table.openPair[side] = view;
          ctx.pairOfElement.set(td, view);
        }
      }
      tr = (
        <tr
          class="hh-line"
          data-side={side}
          data-before={line("before")}
          data-after={line("after")}
        >
          <Num line={line("before")} kind={edge} />
          <Num
            line={line("after")}
            kind={moved ? ` hh-moved-inner${last}` : ""}
          />
          <td class={`hh-code${moved ? ` hh-moved${last}` : ""}`}>
            <span class="hh-sign">{signs[side]}</span>
            {moved && <span class="hh-sr">moved </span>}
            <SpanNodes
              spans={cell.spans}
              side={side}
              place={ctx.placer.lineCursor(index, row.fragment, side, cell.line)}
            />
          </td>
        </tr>
      ) as HTMLTableRowElement;
      ctx.remember(index, row.fragment, tr);
    }
  }
  out.push(tr);
  if (row.kind === "line" && row.fragment >= 0)
    blockCells(ctx, table, row.side, [...tr.children], row.moved, out)();
}
