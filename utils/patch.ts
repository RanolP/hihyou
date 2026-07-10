/**
 * Unified-diff patch construction (pure): turn a run of rendered diff rows
 * back into a `git apply`-able patch. Rows may span hunk boundaries; the
 * builder splits at HUNK rows and old/new line discontinuities.
 */

export interface PatchRow {
  type: string;
  /** Full line text including the leading ' '/'+'/'-' marker. */
  text: string;
  left?: number;
  right?: number;
}

function splitHunks(rows: PatchRow[]): PatchRow[][] {
  const groups: PatchRow[][] = [];
  let cur: PatchRow[] = [];
  let expectLeft: number | null = null;
  let expectRight: number | null = null;
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    expectLeft = expectRight = null;
  };
  for (const row of rows) {
    if (row.type === 'HUNK') {
      flush();
      continue;
    }
    const left = row.type === 'ADDITION' ? null : (row.left ?? null);
    const right = row.type === 'DELETION' ? null : (row.right ?? null);
    if (
      cur.length &&
      ((left !== null && expectLeft !== null && left !== expectLeft) ||
        (right !== null && expectRight !== null && right !== expectRight))
    ) {
      flush();
    }
    cur.push(row);
    if (left !== null) expectLeft = left + 1;
    if (right !== null) expectRight = right + 1;
  }
  flush();
  return groups;
}

export function buildPatch(
  oldPath: string | null,
  newPath: string,
  rows: PatchRow[],
): string | null {
  const groups = splitHunks(rows).filter((g) =>
    g.some((r) => r.type === 'ADDITION' || r.type === 'DELETION'),
  );
  if (!groups.length) return null;
  let out = `--- ${oldPath ? `a/${oldPath}` : '/dev/null'}\n+++ b/${newPath}\n`;
  for (const group of groups) {
    const oldRows = group.filter((r) => r.type !== 'ADDITION');
    const newRows = group.filter((r) => r.type !== 'DELETION');
    const oldStart = oldRows[0]?.left ?? (newRows[0]?.right ?? 1) - 1;
    const newStart = newRows[0]?.right ?? (oldRows[0]?.left ?? 1) - 1;
    out += `@@ -${oldStart},${oldRows.length} +${newStart},${newRows.length} @@\n`;
    for (const row of group) out += `${row.text}\n`;
  }
  return out;
}

/**
 * Expand selected row indices to an applyable region: the contiguous span
 * between the first and last selected row, plus up to `margin` context
 * rows on each side (stopping at hunk headers).
 */
export function patchRowSpan(
  lines: PatchRow[],
  selected: Set<number>,
  margin = 3,
): PatchRow[] {
  const idx = [...selected].sort((a, b) => a - b);
  if (!idx.length) return [];
  let lo = idx[0];
  let hi = idx[idx.length - 1];
  for (let m = 0; m < margin && lo > 0; ) {
    const prev = lines[lo - 1];
    if (!prev || prev.type === 'HUNK') break;
    lo--;
    if (prev.type === 'CONTEXT') m++;
  }
  for (let m = 0; m < margin && hi < lines.length - 1; ) {
    const next = lines[hi + 1];
    if (!next || next.type === 'HUNK') break;
    hi++;
    if (next.type === 'CONTEXT') m++;
  }
  return lines.slice(lo, hi + 1);
}
