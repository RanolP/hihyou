import { z } from "zod";

/**
 * The engine's only unit of input: two opaque, VCS-neutral revision ids.
 * A commit, a range or a PR is converted into one (see `vcs.ts`).
 */
export const Diffset = z.object({
  base: z.string().min(1),
  head: z.string().min(1),
});
export type Diffset = z.infer<typeof Diffset>;

export const FileStatus = z.enum(["added", "deleted", "modified", "renamed"]);
export type FileStatus = z.infer<typeof FileStatus>;

export interface ChangedFile {
  status: FileStatus;
  /** Head-side path, or the base-side path for a deleted file. */
  path: string;
  /** Base-side path, set only for a renamed file. */
  oldPath?: string;
  /** The entry pins a revision of another repository (a git submodule) instead of holding content; it is never read. */
  submodule?: boolean;
}

export type Side = "base" | "head";

/** Everything the engine reads comes through this; it performs no I/O of its own. */
export interface FileSource {
  readonly diffset: Diffset;
  listChanges(): Promise<ChangedFile[]>;
  read(side: Side, path: string): Promise<Uint8Array>;
}

/** Same heuristic as git: a NUL byte in the first 8000 bytes. */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
