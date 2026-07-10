/**
 * Hunk-level "seen" tracking, pure logic.
 *
 * A seen hunk anchors as {side, [start, end], contentHash}: deletions anchor
 * to left/old blob line numbers, additions and context to right/new ones.
 * On payload refresh the hash is recomputed from the lines now visible in
 * that range — a later commit touching the range changes the text (or the
 * rendered context) and the mismatch invalidates the hunk.
 */

export interface SeenInterval {
  start: number;
  end: number;
  hash: string;
}

export interface FileSeenState {
  L: SeenInterval[];
  R: SeenInterval[];
}

/** Keyed by file path. */
export type SeenState = Record<string, FileSeenState>;

/** The subset of DiffLine this module reads. */
export interface SeenLine {
  type: string;
  left?: number;
  right?: number;
  text: string;
}

export type Side = 'L' | 'R';

export function rowSide(line: SeenLine): Side | null {
  if (line.type === 'HUNK') return null;
  return line.type === 'DELETION' ? 'L' : 'R';
}

export function rowNumber(line: SeenLine): number | undefined {
  return rowSide(line) === 'L' ? line.left : line.right;
}

/** djb2 — stability matters, not collision resistance. */
export function hashLines(texts: string[]): string {
  let h = 5381;
  for (const text of texts) {
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    }
    h = ((h << 5) + h + 10) | 0; // '\n'
  }
  return (h >>> 0).toString(36);
}

function sideLines(lines: SeenLine[], side: Side): SeenLine[] {
  return lines.filter((l) => rowSide(l) === side);
}

/** Lines of one side within [start, end], in document order. */
function linesInRange(
  lines: SeenLine[],
  side: Side,
  start: number,
  end: number,
): SeenLine[] {
  return sideLines(lines, side).filter((l) => {
    const n = rowNumber(l)!;
    return n >= start && n <= end;
  });
}

/** Group same-side lines into runs of consecutive numbers → intervals. */
function toIntervals(lines: SeenLine[], side: Side): SeenInterval[] {
  const nums = sideLines(lines, side)
    .map((l) => ({ n: rowNumber(l)!, text: l.text }))
    .sort((a, b) => a.n - b.n);
  const intervals: SeenInterval[] = [];
  let run: { n: number; text: string }[] = [];
  const push = () => {
    if (!run.length) return;
    intervals.push({
      start: run[0].n,
      end: run[run.length - 1].n,
      hash: hashLines(run.map((r) => r.text)),
    });
    run = [];
  };
  for (const item of nums) {
    if (run.length && item.n !== run[run.length - 1].n + 1) push();
    if (!run.length || item.n !== run[run.length - 1].n) run.push(item);
  }
  push();
  return intervals;
}

/** Mark a selection of lines as seen. */
export function markLinesSeen(
  state: FileSeenState | undefined,
  selected: SeenLine[],
): FileSeenState {
  const next: FileSeenState = {
    L: [...(state?.L ?? [])],
    R: [...(state?.R ?? [])],
  };
  for (const side of ['L', 'R'] as const) {
    for (const interval of toIntervals(selected, side)) {
      const dupe = next[side].some(
        (i) =>
          i.start === interval.start &&
          i.end === interval.end &&
          i.hash === interval.hash,
      );
      if (!dupe) next[side].push(interval);
    }
    next[side].sort((a, b) => a.start - b.start);
  }
  return next;
}

/** Remove seen coverage for every given line (used to un-see a file). */
export function clearLinesSeen(
  state: FileSeenState | undefined,
  lines: SeenLine[],
): FileSeenState {
  const next: FileSeenState = { L: [], R: [] };
  if (!state) return next;
  const nums: Record<Side, Set<number>> = { L: new Set(), R: new Set() };
  for (const l of lines) {
    const side = rowSide(l);
    if (side) nums[side].add(rowNumber(l)!);
  }
  for (const side of ['L', 'R'] as const) {
    next[side] = state[side].filter(
      (i) => !overlapsAny(i, nums[side]),
    );
  }
  return next;
}

function overlapsAny(i: SeenInterval, nums: Set<number>): boolean {
  for (const n of nums) if (n >= i.start && n <= i.end) return true;
  return false;
}

export function isLineSeen(
  state: FileSeenState | undefined,
  line: SeenLine,
): boolean {
  const side = rowSide(line);
  if (!state || !side) return false;
  const n = rowNumber(line);
  if (n === undefined) return false;
  return state[side].some((i) => n >= i.start && n <= i.end);
}

/**
 * Drop intervals whose visible content no longer matches. Ranges with no
 * visible lines can't be verified and are kept.
 */
export function validateSeen(
  state: FileSeenState,
  lines: SeenLine[],
): { state: FileSeenState; changed: boolean } {
  let changed = false;
  const next: FileSeenState = { L: [], R: [] };
  for (const side of ['L', 'R'] as const) {
    for (const interval of state[side]) {
      const visible = linesInRange(lines, side, interval.start, interval.end);
      if (
        visible.length === 0 ||
        hashLines(visible.map((l) => l.text)) === interval.hash
      ) {
        next[side].push(interval);
      } else {
        changed = true;
      }
    }
  }
  return { state: next, changed };
}

export function markAllSeen(lines: SeenLine[]): FileSeenState {
  return markLinesSeen(undefined, lines);
}

export function countableLines(lines: SeenLine[]): SeenLine[] {
  return lines.filter((l) => rowSide(l) !== null);
}

export function seenCount(
  state: FileSeenState | undefined,
  lines: SeenLine[],
): number {
  if (!state) return 0;
  return countableLines(lines).filter((l) => isLineSeen(state, l)).length;
}

/**
 * Semantic regrouping (M7): expand a selection so it covers the whole
 * enclosing declaration(s) — a hunk becomes "the changed declaration".
 * Rows are anchored by their right-side coordinate (deletion rows carry
 * the adjacent right number), so everything rendered inside the scope is
 * included. Oversized scopes are left alone.
 */
export function expandSelectionToScopes(
  selected: SeenLine[],
  allLines: SeenLine[],
  scopes: { start: number; end: number }[],
  maxScopeLines = 120,
): SeenLine[] {
  const chosen: { start: number; end: number }[] = [];
  for (const line of selected) {
    const n = line.right;
    if (n === undefined) continue;
    const smallest = scopes
      .filter(
        (s) =>
          s.start <= n && n <= s.end && s.end - s.start + 1 <= maxScopeLines,
      )
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (
      smallest &&
      !chosen.some((c) => c.start === smallest.start && c.end === smallest.end)
    ) {
      chosen.push(smallest);
    }
  }
  if (!chosen.length) return selected;
  const out = new Set(selected);
  for (const line of allLines) {
    if (line.type === 'HUNK' || line.right === undefined) continue;
    if (chosen.some((c) => c.start <= line.right! && line.right! <= c.end)) {
      out.add(line);
    }
  }
  return [...out];
}

export function fileFullySeen(
  state: FileSeenState | undefined,
  lines: SeenLine[],
): boolean {
  const countable = countableLines(lines);
  return (
    countable.length > 0 && countable.every((l) => isLineSeen(state, l))
  );
}
