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

/** Hunk groups that actually change something. */
export function changedGroups(rows: PatchRow[]): PatchRow[][] {
  return splitHunks(rows).filter((g) =>
    g.some((r) => r.type === 'ADDITION' || r.type === 'DELETION'),
  );
}

/**
 * Apply hunk groups to file text in memory (what `git apply` would do),
 * verifying old-side content first. Groups apply bottom-up so earlier
 * line numbers stay valid.
 */
export function applyGroupsToText(
  text: string,
  groups: PatchRow[][],
): { ok: true; text: string } | { ok: false; detail: string } {
  const lines = text.split('\n');
  const anchored = groups.map((g) => ({
    g,
    start: g.find((r) => r.type !== 'ADDITION')?.left,
  }));
  if (anchored.some((a) => a.start === undefined)) {
    return { ok: false, detail: 'hunk without old-side anchor' };
  }
  anchored.sort((a, b) => b.start! - a.start!);
  for (const { g, start } of anchored) {
    const oldRows = g.filter((r) => r.type !== 'ADDITION');
    for (let i = 0; i < oldRows.length; i++) {
      if (lines[start! - 1 + i] !== oldRows[i].text.slice(1)) {
        return { ok: false, detail: `content mismatch at line ${start! + i}` };
      }
    }
    const newTexts = g
      .filter((r) => r.type !== 'DELETION')
      .map((r) => r.text.slice(1));
    lines.splice(start! - 1, oldRows.length, ...newTexts);
  }
  return { ok: true, text: lines.join('\n') };
}

/** Deletion/addition pairs differing only in whitespace (always applied). */
export function whitespaceOnlyRows(rows: PatchRow[]): PatchRow[] {
  const out: PatchRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type !== 'DELETION') continue;
    const dels: PatchRow[] = [];
    while (rows[i]?.type === 'DELETION') dels.push(rows[i++]);
    const adds: PatchRow[] = [];
    while (rows[i]?.type === 'ADDITION') adds.push(rows[i++]);
    i--;
    if (dels.length !== adds.length) continue;
    const strip = (r: PatchRow) => r.text.slice(1).replace(/\s+/g, '');
    for (let j = 0; j < dels.length; j++) {
      if (strip(dels[j]) === strip(adds[j]) && strip(dels[j]).length > 0) {
        out.push(dels[j], adds[j]);
      }
    }
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
