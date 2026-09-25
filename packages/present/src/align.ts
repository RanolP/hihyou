import { diffArrays } from "diff";

/** Maps offsets between a text and its formatted version. */
export interface Alignment {
  /** The formatted span covering the same tokens as the original span `[start, end)`. */
  range(start: number, end: number): [number, number];
  /** The original offset of the first formatted character in `[start, end)` that the original also has; undefined when the formatter inserted them all. */
  original(start: number, end: number): number | undefined;
}

/**
 * Past this many differing characters the formatter rewrote more than layout, and the map would be
 * mostly guesses; Myers' diff also costs O(D^2) here.
 */
const maxEditLength = 5000;

/**
 * A formatter keeps the token sequence and changes only the whitespace between tokens, so the
 * non-whitespace characters of both texts line up one to one; walking them in lockstep gives an
 * exact offset map. Myers' diff generalizes the lockstep walk: when the characters are identical it
 * is exactly that walk, and where the formatter did change tokens (added parentheses or trailing
 * commas) the unmatched characters snap to the nearest matched anchor. Returns undefined past the
 * edit budget.
 */
export function align(
  original: string,
  formatted: string,
): Alignment | undefined {
  const a = solid(original);
  const b = solid(formatted);
  const changes = diffArrays(a.chars, b.chars, {
    maxEditLength,
    // Quote style is the most common rewrite; treating quotes as equal keeps strings as anchors.
    comparator: (x, y) => x === y || (isQuote(x) && isQuote(y)),
  });
  if (!changes) return undefined;

  // For each solid character, the index of its partner on the other side, or -1.
  const aToB = new Int32Array(a.chars.length).fill(-1);
  const bToA = new Int32Array(b.chars.length).fill(-1);
  let i = 0;
  let j = 0;
  for (const change of changes) {
    if (change.removed) i += change.count;
    else if (change.added) j += change.count;
    else
      for (let k = 0; k < change.count; k++, i++, j++) {
        aToB[i] = j;
        bToA[j] = i;
      }
  }

  return {
    range(start, end) {
      const first = lowerBound(a.offsets, start);
      const last = lowerBound(a.offsets, end) - 1;
      // A whitespace-only span has no token to follow, so it collapses to a point before the next token.
      if (first > last) {
        const at = startOf(first);
        return [at, at];
      }
      const from = startOf(first);
      return [from, Math.max(from, endOf(last))];
    },
    original(start, end) {
      for (
        let m = lowerBound(b.offsets, start);
        (b.offsets[m] ?? Infinity) < end;
        m++
      ) {
        const partner = bToA[m] ?? -1;
        if (partner >= 0) return a.offsets[partner];
      }
      return undefined;
    },
  };

  // Formatted offset where original solid character `k` starts; unmatched, just past the previous anchor.
  function startOf(k: number): number {
    for (let m = k; m >= 0; m--) {
      const partner = aToB[m] ?? -1;
      if (partner < 0) continue;
      const at = b.offsets[partner] ?? formatted.length;
      return m === k ? at : skipSpace(formatted, at + 1, 1);
    }
    return skipSpace(formatted, 0, 1);
  }

  // Formatted offset just past original solid character `k`; unmatched, just before the next anchor.
  function endOf(k: number): number {
    for (let m = k; m < a.chars.length; m++) {
      const partner = aToB[m] ?? -1;
      if (partner < 0) continue;
      const at = b.offsets[partner] ?? formatted.length;
      return m === k ? at + 1 : skipSpace(formatted, at, -1);
    }
    return skipSpace(formatted, formatted.length, -1);
  }
}

/** The non-whitespace characters of `text` and their offsets. */
function solid(text: string): { chars: string[]; offsets: number[] } {
  const chars: string[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (isSpace(c)) continue;
    chars.push(c);
    offsets.push(i);
  }
  return { chars, offsets };
}

const isSpace = (c: string) => /\s/.test(c);
const isQuote = (c: string) => c === '"' || c === "'" || c === "`";

/** From `at`, moves in `step` direction past whitespace; backward, returns the offset just past the last solid char. */
function skipSpace(text: string, at: number, step: 1 | -1): number {
  if (step === 1) {
    while (at < text.length && isSpace(text.charAt(at))) at++;
    return at;
  }
  while (at > 0 && isSpace(text.charAt(at - 1))) at--;
  return at;
}

/** The first index whose value is >= `x`. */
function lowerBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? Infinity) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
