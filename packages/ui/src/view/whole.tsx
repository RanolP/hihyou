import type { JSX } from "solid-js";
import type { Row, UnifiedRow } from "../rows.js";
import { type WholeHeader, wholeKey } from "../whole.js";
import type { DrawContext } from "./context.js";

const stateText = { viewed: "✓ Viewed", partial: "Partly viewed", unviewed: "" };

/**
 * "added function extra" above a whole unit's first line. Its button selects the whole node, so `v` marks every
 * atom in it, while j/k and `i` still reach each atom inside on its own.
 */
function WholeRow(props: {
  ctx: DrawContext;
  header: WholeHeader;
  columns: number;
}): JSX.Element {
  const { ctx, header, columns } = props;
  const t = { kind: "node", ...header.ref } as const;
  const state = () => ctx.viewState(t);
  return (
    <tr
      class={`hh-whole hh-whole-${header.whole}`}
      classList={{
        "hh-whole-viewed": state() === "viewed",
        "hh-whole-partial": state() === "partial",
      }}
    >
      <th scope="row" colSpan={columns}>
        <button
          type="button"
          class="hh-button hh-whole-label"
          aria-label={`Select ${header.text}`}
          on:click={() => ctx.select(t)}
        >
          {header.text}
        </button>
        <span class="hh-whole-state">{stateText[state() ?? "unviewed"]}</span>
      </th>
    </tr>
  );
}

/** The header rows that open on this row's lines, pushed into `out` ahead of the row. */
export function wholeRows(
  ctx: DrawContext,
  headers: ReadonlyMap<string, WholeHeader>,
  row: Row | UnifiedRow,
  columns: number,
  out: JSX.Element[],
): void {
  if (headers.size === 0) return;
  const keys: string[] = [];
  if (row.kind === "diff") {
    if (row.before) keys.push(wholeKey(row.fragment, "before", row.before.line));
    if (row.after) keys.push(wholeKey(row.fragment, "after", row.after.line));
  } else if (row.kind === "line")
    keys.push(wholeKey(row.fragment, row.side, row.cell.line));
  else if (row.kind === "merged") {
    if (row.before !== undefined) keys.push(wholeKey(row.fragment, "before", row.before));
    if (row.after !== undefined) keys.push(wholeKey(row.fragment, "after", row.after));
  }
  for (const k of keys) {
    const header = headers.get(k);
    if (header) out.push(<WholeRow ctx={ctx} header={header} columns={columns} />);
  }
}
