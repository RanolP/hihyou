import type { CollapseReason } from "@hihyou/engine";
import type { JSX } from "solid-js";
import { buildSections, type DiffFile, unifiedRows } from "../rows.js";
import type { TableDraw } from "./block.js";
import { useDraw } from "./context.js";
import { pairRows } from "./pair-rows.jsx";
import { beforeCells } from "./placement.js";
import { splitRow } from "./split.jsx";
import { unifiedRow } from "./unified.jsx";
import { wholeRows } from "./whole.jsx";
import { wholeHeaders } from "../whole.js";

const reasons: Record<CollapseReason, string> = {
  generated: "Generated file",
  lockfile: "Lockfile",
  binary: "Binary file",
  submodule: "Submodule",
  "too-large": "Too large for a syntax diff",
  "parse-error": "Did not parse cleanly",
  "format-only": "Only formatting changed",
  moved: "Only moved code",
};

const headings = {
  unified: [
    ["Before line", true],
    ["After line", true],
    ["Code", true],
  ],
  split: [
    ["Before line", true],
    ["Before", false],
    ["After line", true],
    ["After", false],
  ],
} as const;

const cols = {
  unified: ["hh-col-num", "hh-col-num", "hh-col-code"],
  split: ["hh-col-num", "hh-col-code", "hh-col-num", "hh-col-code"],
} as const;

/** One file's table, unified or split; a collapsed file shows why until it is opened. */
export function FileTable(props: { index: number; file: DiffFile }): JSX.Element {
  const ctx = useDraw();
  const { index, file } = props;
  const layout = ctx.layout();
  const unified = layout === "unified";
  const columns = unified ? 3 : 4;
  const reason = file.collapsed?.reason;
  const bodies: JSX.Element[] = [];
  if (reason && !ctx.isOpened(file.path))
    bodies.push(
      <tbody>
        <tr class="hh-collapsed">
          <td class="hh-collapsed-cell" colSpan={columns}>
            <span>{reasons[reason]}</span>
            {file.fragments.length > 0 && [
              " ",
              <button
                type="button"
                class="hh-button"
                on:click={() => ctx.open(file.path)}
              >
                Show diff
              </button>,
            ]}
          </td>
        </tr>
      </tbody>,
    );
  else {
    const table: TableDraw = {
      index,
      openPair: {},
      pairRows: (view, out) => pairRows(ctx, table, view, out),
    };
    const headers = wholeHeaders(file, index);
    // A sticky row sticks for the rest of the table, not just its own tbody; `buildSections` decides which
    // sections carry one, replacing a header that would otherwise go stale with a "top level" one.
    for (const section of buildSections(file)) {
      const rows: JSX.Element[] = [];
      if (section.heading)
        rows.push(
          <tr class="hh-node">
            <th scope="rowgroup" colSpan={columns}>
              {section.path.length > 0 ? (
                <span class="hh-node-label">{section.path.join(" › ")}</span>
              ) : (
                <span class="hh-node-label hh-top">top level</span>
              )}
            </th>
          </tr>,
        );
      if (unified) {
        ctx.placer.queueBefore(beforeCells(section.rows));
        for (const row of unifiedRows(section.rows)) {
          wholeRows(ctx, headers, row, columns, rows);
          unifiedRow(ctx, table, row, rows);
        }
      } else
        for (const row of section.rows) {
          wholeRows(ctx, headers, row, columns, rows);
          splitRow(ctx, table, row, rows);
        }
      bodies.push(<tbody>{rows}</tbody>);
    }
  }
  return (
    <table class={`hh-table hh-${layout}`}>
      <caption class="hh-sr">
        {`${unified ? "Unified" : "Split"} diff of ${file.path}`}
      </caption>
      <colgroup>
        {cols[layout].map((c) => (
          <col class={c} />
        ))}
      </colgroup>
      <thead class="hh-head">
        <tr>
          {headings[layout].map(([label, hidden]) => (
            <th scope="col">
              <span class={hidden ? "hh-sr" : undefined}>{label}</span>
            </th>
          ))}
        </tr>
      </thead>
      {bodies}
    </table>
  );
}
