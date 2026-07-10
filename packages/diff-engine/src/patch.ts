/**
 * Applied-view helpers (pure). "Applied" renders the diff as if the change
 * landed: removals disappear, additions become plain code.
 */

export interface PatchRow {
  type: string;
  /** Full line text including the leading ' '/'+'/'-' marker. */
  text: string;
  left?: number;
  right?: number;
}

/** Deletion/addition pairs differing only in whitespace (auto-applied). */
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
