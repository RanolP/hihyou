import type { JSX } from "solid-js";
import { buildSections, type DiffFile, unifiedRows } from "../rows.js";
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
    for (const row of unifiedRows(section.rows)) {
      wholeRows(ctx, headers, row, columns, rows);
      const scopePath =
        row.kind === "elided"
          ? row.count === 0
            ? section.path
            : sections[sectionIndex + 1]?.path
          : undefined;
      unifiedRow(
        ctx,
        table,
        row,
        rows,
        scopeLabel(scopePath),
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
