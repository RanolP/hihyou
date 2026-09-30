import type { ObjectStore, Sha } from "./objects.js";
import type { RefStore } from "./refs.js";

/**
 * A commit named the way `git rev-parse` names one, for the subset a diff picker needs: `HEAD`/`@`, a
 * full or abbreviated SHA, a branch, tag or remote name, followed by any run of `~n`, `^` and `^n`.
 * Tags are peeled to their commit.
 */
export function resolveRev(
  refs: RefStore,
  objects: ObjectStore,
  spec: string,
): Sha {
  const m = /^(.*?)((?:[~^]\d*)*)$/.exec(spec);
  const name = m?.[1] ?? spec;
  let sha = peelToCommit(objects, resolveName(refs, objects, name), spec);
  for (const [, op, digits] of (m?.[2] ?? "").matchAll(/([~^])(\d*)/g)) {
    const n = digits === "" ? 1 : Number(digits);
    if (op === "~") {
      for (let i = 0; i < n; i++) sha = parentOf(objects, sha, 0, spec);
    } else if (n > 0) {
      sha = parentOf(objects, sha, n - 1, spec);
    }
  }
  return sha;
}

function resolveName(refs: RefStore, objects: ObjectStore, name: string): Sha {
  if (name === "" || name === "@") name = "HEAD";
  if (/^[0-9a-f]{40}$/i.test(name)) {
    const sha = name.toLowerCase();
    if (objects.has(sha)) return sha;
    throw new Error(`unknown revision ${name}`);
  }
  for (const candidate of [
    name,
    `refs/${name}`,
    `refs/tags/${name}`,
    `refs/heads/${name}`,
    `refs/remotes/${name}`,
    `refs/remotes/${name}/HEAD`,
  ]) {
    const sha = refs.resolve(candidate);
    if (sha) return sha;
  }
  if (/^[0-9a-f]{4,39}$/i.test(name)) {
    const found = objects.expand(name.toLowerCase());
    if (found.length === 1) return found[0] as Sha;
    if (found.length > 1) throw new Error(`short SHA ${name} is ambiguous`);
  }
  throw new Error(`unknown revision ${name}`);
}

function peelToCommit(objects: ObjectStore, sha: Sha, spec: string): Sha {
  const peeled = objects.peel(sha);
  if (peeled.type !== "commit")
    throw new Error(`${spec} names a ${peeled.type}, not a commit`);
  return peeled.sha;
}

function parentOf(
  objects: ObjectStore,
  sha: Sha,
  i: number,
  spec: string,
): Sha {
  const parent = objects.readCommit(sha).parents[i];
  if (!parent) throw new Error(`${spec}: ${sha} has no parent #${i + 1}`);
  return parent;
}

const ONE = 1;
const TWO = 2;
const STALE = 4;
const RESULT = 8;

/**
 * The best common ancestor, walked newest-first by committer time as `git merge-base` does. With
 * several best candidates (a criss-cross merge) it returns the newest one rather than all of them.
 */
export function mergeBase(
  objects: ObjectStore,
  a: Sha,
  b: Sha,
): Sha | undefined {
  if (a === b) return a;
  const flags = new Map<Sha, number>();
  const queue = new CommitQueue(objects);
  flags.set(a, ONE);
  flags.set(b, TWO);
  queue.push(a);
  queue.push(b);
  const results: Sha[] = [];
  while (queue.hasNonStale(flags)) {
    const sha = queue.pop() as Sha;
    let f = (flags.get(sha) ?? 0) & (ONE | TWO | STALE);
    if ((f & (ONE | TWO)) === (ONE | TWO)) {
      const own = flags.get(sha) ?? 0;
      if (!(own & RESULT)) {
        flags.set(sha, own | RESULT);
        results.push(sha);
      }
      f |= STALE;
    }
    for (const parent of objects.readCommit(sha).parents) {
      const pf = flags.get(parent) ?? 0;
      if ((pf & f) === f) continue;
      flags.set(parent, pf | f);
      queue.push(parent);
    }
  }
  return results.find((sha) => !((flags.get(sha) ?? 0) & STALE));
}

/** A max-heap of commits by committer time. */
class CommitQueue {
  private readonly shas: Sha[] = [];
  private readonly times: number[] = [];

  constructor(private readonly objects: ObjectStore) {}

  push(sha: Sha): void {
    this.shas.push(sha);
    this.times.push(this.objects.readCommit(sha).time);
    let i = this.shas.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.time(up) >= this.time(i)) break;
      this.swap(up, i);
      i = up;
    }
  }

  pop(): Sha | undefined {
    const top = this.shas[0];
    const n = this.shas.length - 1;
    this.swap(0, n);
    this.shas.pop();
    this.times.pop();
    for (let i = 0; ;) {
      const l = 2 * i + 1;
      let m = i;
      if (l < n && this.time(l) > this.time(m)) m = l;
      if (l + 1 < n && this.time(l + 1) > this.time(m)) m = l + 1;
      if (m === i) break;
      this.swap(m, i);
      i = m;
    }
    return top;
  }

  hasNonStale(flags: Map<Sha, number>): boolean {
    return this.shas.some((sha) => !((flags.get(sha) ?? 0) & STALE));
  }

  private time(i: number): number {
    return this.times[i] as number;
  }

  private swap(i: number, j: number): void {
    const { shas, times } = this;
    [shas[i], shas[j]] = [shas[j] as Sha, shas[i] as Sha];
    [times[i], times[j]] = [times[j] as number, times[i] as number];
  }
}
