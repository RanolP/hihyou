/**
 * Side-aware node picking (pure): a pick made on a deletion row refers to
 * old-blob lines (L), everything else to new-blob lines (R). Rows belong
 * to a pick by the matching side's line number; context rows exist on
 * both blobs, additions only on R, deletions only on L.
 */

export interface PickedRange {
  side: 'L' | 'R';
  start: number;
  end: number;
}

export interface PickRow {
  type: string;
  left?: number;
  right?: number;
}

export function rowInPick(line: PickRow, pick: PickedRange): boolean {
  if (line.type === 'HUNK') return false;
  if (pick.side === 'R') {
    return (
      line.right !== undefined &&
      line.right >= pick.start &&
      line.right <= pick.end
    );
  }
  return (
    line.type !== 'ADDITION' &&
    line.left !== undefined &&
    line.left >= pick.start &&
    line.left <= pick.end
  );
}
