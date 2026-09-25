import type { ChangedFile, Diffset, FileSource } from "./file-source.js";

/** Base id of a Diffset whose head has no parent; each Vcs maps it to its own empty state. */
export const emptyRevision = "(empty)";

/** The only place version-control commands run. Ids are whatever the VCS uses as stable revision ids. */
export interface Vcs {
  /** Resolves a user-given revision expression to a stable id. */
  resolve(expr: string): Promise<string>;
  parents(id: string): Promise<string[]>;
  mergeBase(a: string, b: string): Promise<string>;
  /** `base` may be `emptyRevision`. */
  changes(base: string, head: string): Promise<ChangedFile[]>;
  read(id: string, path: string): Promise<Uint8Array>;
}

export function vcsFileSource(vcs: Vcs, diffset: Diffset): FileSource {
  return {
    diffset,
    listChanges: () => vcs.changes(diffset.base, diffset.head),
    read: (side, path) => vcs.read(diffset[side], path),
  };
}

/** One commit against its first parent. */
export async function diffsetFromCommit(
  vcs: Vcs,
  rev: string,
): Promise<Diffset> {
  const head = await vcs.resolve(rev);
  const [parent] = await vcs.parents(head);
  return { base: parent ?? emptyRevision, head };
}

export async function diffsetFromRange(
  vcs: Vcs,
  base: string,
  head: string,
): Promise<Diffset> {
  return { base: await vcs.resolve(base), head: await vcs.resolve(head) };
}

/** A PR reviews head against the merge-base with its base branch, as GitHub's "Files changed" does. */
export async function diffsetFromPr(
  vcs: Vcs,
  baseBranch: string,
  headRef: string,
): Promise<Diffset> {
  const head = await vcs.resolve(headRef);
  return {
    base: await vcs.mergeBase(await vcs.resolve(baseBranch), head),
    head,
  };
}
