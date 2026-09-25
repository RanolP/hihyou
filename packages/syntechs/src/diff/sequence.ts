import { diffArrays } from "diff";

/** Pairs of equal elements along a longest common subsequence (Myers diff, so O(ND) rather than O(NM)). */
export function commonPairs<T>(
  xs: T[],
  ys: T[],
  eq: (x: T, y: T) => boolean,
): [T, T][] {
  // diffArrays calls the comparator as (old, new), and a common run's value holds the new-side elements;
  // the old side's are the next ones in `xs`, since removed and common runs consume it in order.
  const old = xs.values();
  const pairs: [T, T][] = [];
  for (const c of diffArrays(xs, ys, { comparator: eq })) {
    if (c.added) continue;
    for (const y of c.value) {
      const x = old.next();
      if (x.done)
        throw new Error(
          `commonPairs: diff consumed more than the ${xs.length} old elements`,
        );
      if (!c.removed) pairs.push([x.value, y]);
    }
  }
  return pairs;
}

interface Tail {
  index: number;
  value: number;
  prev: Tail | undefined;
}

/** Indices (into `xs`) of one longest strictly increasing subsequence. */
export function longestIncreasing(xs: number[]): Set<number> {
  // tails[k] ends the smallest-valued increasing run of length k + 1 seen so far.
  const tails: Tail[] = [];
  for (const [index, value] of xs.entries()) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((tails[mid]?.value ?? Infinity) < value) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = { index, value, prev: tails[lo - 1] };
  }
  const keep = new Set<number>();
  for (let t = tails.at(-1); t; t = t.prev) keep.add(t.index);
  return keep;
}
