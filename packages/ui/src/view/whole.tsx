import type { JSX } from "solid-js";
import type { Row, UnifiedRow } from "../rows.js";
import { wholeKey } from "../whole.js";

const rowKeys = (row: Row | UnifiedRow): string[] => {
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
  return keys;
};

/** Whether a whole unit (from `wholeStarts`) opens on this row's lines. */
export const startsWhole = (starts: ReadonlySet<string>, row: Row | UnifiedRow): boolean =>
  starts.size > 0 && rowKeys(row).some((key) => starts.has(key));

/**
 * The rule above a whole unit's first line. It carries no text: the code under it already says what was added or
 * removed, and a click on that code selects it, with `o` widening to the whole unit.
 */
export const wholeRule = (columns: number): JSX.Element => (
  <tr class="hh-whole" aria-hidden="true">
    <td colSpan={columns} />
  </tr>
);
