import { diffArrays } from "diff";

/** Pairs of equal elements along a longest common subsequence (Myers diff, so O(ND) rather than O(NM)). */
export function commonPairs<A, B>(
  xs: A[],
  ys: B[],
  eq: (x: A, y: B) => boolean,
): [A, B][] {
  // diffArrays compares elements of one type; old indices >= 0 and new indices < 0 let each side keep its own.
  const changes = diffArrays(
    xs.map((_, i) => i),
    ys.map((_, j) => -1 - j),
    {
      comparator: (p, q) =>
        p >= 0
          ? eq(xs[p] as A, ys[-1 - q] as B)
          : eq(xs[q] as A, ys[-1 - p] as B),
    },
  );
  const pairs: [A, B][] = [];
  let i = 0;
  let j = 0;
  for (const c of changes) {
    const n = c.count ?? c.value.length;
    if (c.added) j += n;
    else if (c.removed) i += n;
    else for (let k = 0; k < n; k++) pairs.push([xs[i++] as A, ys[j++] as B]);
  }
  return pairs;
}

/** Indices (into `xs`) of one longest strictly increasing subsequence. */
export function longestIncreasing(xs: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((xs[tails[mid] as number] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] as number;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i] as number) keep.add(i);
  return keep;
}
