/**
 * Import folding (pure): which rendered diff rows fall inside the file's
 * import block. Rows are anchored by their right-side coordinate (deletion
 * rows carry the adjacent right number), so removed imports fold too.
 */

import type { LineRange } from './ast-service';

export interface FoldInfo {
  startIdx: number;
  endIdx: number;
  /** Rows hidden by the fold. */
  total: number;
  /** Hidden rows that are additions/deletions. */
  changed: number;
}

export interface FoldLine {
  type: string;
  right?: number;
}

const MIN_FOLD_ROWS = 4;

export function importFold(
  lines: FoldLine[],
  importRanges: LineRange[],
): FoldInfo | null {
  if (!importRanges.length) return null;
  const lo = Math.min(...importRanges.map((r) => r.start));
  const hi = Math.max(...importRanges.map((r) => r.end));
  let startIdx = -1;
  let endIdx = -1;
  lines.forEach((l, i) => {
    if (l.type === 'HUNK' || l.right === undefined) return;
    if (l.right >= lo && l.right <= hi) {
      if (startIdx < 0) startIdx = i;
      endIdx = i;
    }
  });
  if (startIdx < 0 || endIdx - startIdx + 1 < MIN_FOLD_ROWS) return null;
  let changed = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const t = lines[i].type;
    if (t === 'ADDITION' || t === 'DELETION') changed++;
  }
  return { startIdx, endIdx, total: endIdx - startIdx + 1, changed };
}
