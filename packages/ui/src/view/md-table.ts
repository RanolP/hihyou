import type { Span } from "@hihyou/engine";
import type { DiffFile } from "../rows.js";

/*
 * A Markdown pipe table keeps one source line per row, so its cells line up only if every row of it shares one
 * set of column widths. Each row is drawn as a grid; the widths come from every table row of the diffset with
 * the same number of cells, weighted by how long its cells run, so a row of a table and the next row agree.
 */

/** A `|` between cells, as the highlighter scopes it; a whole delimiter row (`|---|`) carries this scope too. */
export const isPipe = (span: Span): boolean =>
  span.text.trim() === "|" &&
  (span.scope?.includes("punctuation.definition.table.markdown") ?? false);

export const isTableSpan = (span: Span): boolean =>
  span.scope?.includes("markup.table.markdown") ?? false;

const ROW = /^\s*\|.*\|\s*$/;
const DELIMITER = /^[\s|:-]+$/;
/** A cell longer than this weighs no more: one long description should not starve every other column. */
const LONGEST = 60;

const cache = new WeakMap<readonly DiffFile[], Map<number, number[]>>();

/** Per cell count, each column's share of a table row's width. */
export function columnWeights(
  files: readonly DiffFile[],
): Map<number, number[]> {
  const known = cache.get(files);
  if (known) return known;
  const sums = new Map<number, { rows: number; lengths: number[] }>();
  const addText = (text: string) => {
    for (const line of text.split("\n")) {
      if (!ROW.test(line) || DELIMITER.test(line)) continue;
      const cells = line.trim().slice(1, -1).split(/(?<!\\)\|/);
      let sum = sums.get(cells.length);
      if (!sum) sums.set(cells.length, (sum = { rows: 0, lengths: [] }));
      sum.rows++;
      cells.forEach((cell, i) => {
        sum.lengths[i] = (sum.lengths[i] ?? 0) + Math.min(cell.trim().length, LONGEST);
      });
    }
  };
  const join = (spans: readonly Span[]) => spans.map((s) => s.text).join("");
  for (const file of files) {
    if (!file.grammar?.startsWith("markdown@")) continue;
    for (const fragment of file.fragments) {
      if (fragment.kind === "unchanged") addText(join(fragment.spans));
      else if (fragment.kind === "diff") {
        addText(join(fragment.before.spans));
        addText(join(fragment.after.spans));
      }
    }
  }
  const weights = new Map<number, number[]>();
  for (const [count, { rows, lengths }] of sums)
    weights.set(
      count,
      Array.from({ length: count }, (_, i) => Math.max(3, (lengths[i] ?? 0) / rows)),
    );
  cache.set(files, weights);
  return weights;
}
