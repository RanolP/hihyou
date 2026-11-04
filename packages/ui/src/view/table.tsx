import type { JSX } from "solid-js";
import {
  buildSections,
  type DiffFile,
  type UnifiedRow,
  unifiedRows,
} from "../rows.js";
import type { TableDraw } from "./block.js";
import { useDraw } from "./context.js";
import { pairRows } from "./pair-rows.jsx";
import { beforeCells } from "./placement.js";
import { unifiedRow } from "./unified.jsx";
import { wholeRows } from "./whole.jsx";
import { wholeHeaders } from "../whole.js";

const headings = ["Before line", "After line", "Code"];
const scopeLabel = (path: readonly string[] | undefined) =>
  path && path.length > 0 ? path.join(" › ") : undefined;
const scopeAfterGap = (
  sections: ReturnType<typeof buildSections>,
  sectionIndex: number,
) => {
  for (const section of sections.slice(sectionIndex + 1)) {
    const first = section.rows.find(
      (row) => row.kind === "diff" || (row.kind === "elided" && row.count !== 0),
    );
    if (first?.kind === "diff") return section.path;
    if (first?.kind === "elided") return undefined;
  }
};

/**
 * Whether each row is a line in a run of one side's lines alone: a run with nothing of the other side to compare
 * against reads as new or gone whole, as GitHub draws it, so its words get no emphasis.
 */
const loneLines = (rows: readonly UnifiedRow[]): boolean[] => {
  const lone = rows.map(() => false);
  for (let start = 0; start < rows.length; ) {
    let end = start;
    const sides = new Set<string>();
    for (; end < rows.length; end++) {
      const row = rows[end]!;
      if (row.kind !== "line" || row.moved) break;
      sides.add(row.side);
    }
    if (sides.size === 1) for (let i = start; i < end; i++) lone[i] = true;
    start = Math.max(end, start + 1);
  }
  return lone;
};

/** One opened file's diff table. */
export function FileTable(props: { index: number; file: DiffFile }): JSX.Element {
  const ctx = useDraw();
  const { index, file } = props;
  const columns = 3;
  const bodies: JSX.Element[] = [];
  const table: TableDraw = {
    index,
    openPair: {},
    pairRows: (view, out) => pairRows(ctx, table, view, out),
  };
  const headers = wholeHeaders(file, index);
  // A sticky row sticks for the rest of the table, not just its own tbody; `buildSections` decides which
  // sections carry one, replacing a header that would otherwise go stale with a "top level" one.
  const sections = buildSections(file);
  for (const [sectionIndex, section] of sections.entries()) {
    const rows: JSX.Element[] = [];
    if (section.heading)
      rows.push(
        <tr class="hh-node">
          <th scope="rowgroup" colSpan={columns}>
            {section.path.length > 0 ? (
              <span class="hh-node-label">{scopeLabel(section.path)}</span>
            ) : (
              <span class="hh-node-label hh-top">top level</span>
            )}
          </th>
        </tr>,
      );
    ctx.placer.queueBefore(beforeCells(section.rows));
    const unified = unifiedRows(section.rows);
    const lone = loneLines(unified);
    for (const [rowIndex, row] of unified.entries()) {
      wholeRows(ctx, headers, row, columns, rows);
      const scopePath =
        row.kind === "elided"
          ? row.count === 0
            ? section.path
            : // The next section's own header row, right under the gap, already names it.
              rowIndex === unified.length - 1 &&
                sections[sectionIndex + 1]?.heading
              ? undefined
              : scopeAfterGap(sections, sectionIndex)
          : undefined;
      unifiedRow(
        ctx,
        table,
        row,
        rows,
        scopeLabel(scopePath),
        lone[rowIndex],
      );
    }
    bodies.push(<tbody>{rows}</tbody>);
  }
  return (
    <table class="hh-table">
      <caption class="hh-sr">{`Diff of ${file.path}`}</caption>
      <colgroup>
        <col class="hh-col-num" />
        <col class="hh-col-num" />
        <col class="hh-col-code" />
      </colgroup>
      <thead class="hh-head">
        <tr>
          {headings.map((label) => (
            <th scope="col">
              <span class="hh-sr">{label}</span>
            </th>
          ))}
        </tr>
      </thead>
      {bodies}
    </table>
  );
}
