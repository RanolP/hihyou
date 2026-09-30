import {
  type BigIntStats,
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { join } from "node:path";
import { type IndexEntry, parseIndex } from "./git-index.js";
import { GITLINK, hashBlob, type Sha, SYMLINK } from "./objects.js";
import type { FileMap } from "./tree-diff.js";

export interface WorktreeSnapshot {
  /** The index's merged (stage 0) entries, minus intent-to-add ones, which hold no content yet. */
  index: FileMap;
  /** The same paths as they are on disk now; a file missing on disk is absent. */
  worktree: FileMap;
  /** Paths with unresolved merge conflicts. Their disk content is in `worktree`, never in `index`. */
  conflicted: string[];
}

export interface WorktreeOptions {
  workTree: string;
  indexPath: string;
  /** `core.filemode`: when false, the executable bit on disk is ignored, as on Windows. */
  fileMode: boolean;
  /** Receives the bytes of every file hashed, so a later `readBlob` of its id needs no re-read. */
  onHashed(sha: Sha, bytes: Uint8Array): void;
  /** HEAD of the repository checked out at a submodule path, if it has one. */
  submoduleHead(path: string): Sha | undefined;
}

/**
 * The index and the working tree as two file maps. A file whose lstat matches its index entry is
 * taken at the index's id unread, as `git status` does; only the rest is read and hashed.
 */
export function snapshotWorktree(options: WorktreeOptions): WorktreeSnapshot {
  let raw: Buffer;
  try {
    raw = readFileSync(options.indexPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { index: new Map(), worktree: new Map(), conflicted: [] };
  }
  const indexStat = lstatSync(options.indexPath, { bigint: true });
  const index: FileMap = new Map();
  const worktree: FileMap = new Map();
  const conflicted = new Set<string>();
  for (const e of parseIndex(raw)) {
    if (e.stage !== 0) {
      if (!conflicted.has(e.path)) {
        conflicted.add(e.path);
        const disk = onDisk(options, e, indexStat, true);
        if (disk) worktree.set(e.path, disk);
      }
      continue;
    }
    if (!e.intentToAdd) index.set(e.path, { mode: e.mode, sha: e.sha });
    const disk =
      e.skipWorktree || e.assumeValid
        ? { mode: e.mode, sha: e.sha }
        : onDisk(options, e, indexStat, e.intentToAdd);
    if (disk) worktree.set(e.path, disk);
  }
  return { index, worktree, conflicted: [...conflicted] };
}

function onDisk(
  options: WorktreeOptions,
  e: IndexEntry,
  indexStat: BigIntStats,
  forceHash: boolean,
): { mode: number; sha: Sha } | undefined {
  const full = join(options.workTree, e.path);
  if (e.mode === GITLINK) {
    // An uninitialized submodule is an empty directory, which git shows as unchanged.
    if (!existsSync(join(full, ".git"))) return { mode: e.mode, sha: e.sha };
    return { mode: e.mode, sha: options.submoduleHead(full) ?? e.sha };
  }
  const st = lstatOrUndefined(full);
  if (!st || !(st.isFile() || st.isSymbolicLink())) return undefined;
  const mode = st.isSymbolicLink()
    ? SYMLINK
    : !options.fileMode && e.mode !== SYMLINK
      ? e.mode
      : st.mode & 0o100n
        ? 0o100755
        : 0o100644;
  if (!forceHash && mode === e.mode && statMatches(e, st, indexStat))
    return { mode, sha: e.sha };
  const bytes = st.isSymbolicLink()
    ? readlinkSync(full, { encoding: "buffer" })
    : readFileSync(full);
  const sha = hashBlob(bytes);
  if (sha !== e.sha) options.onHashed(sha, bytes);
  return { mode, sha };
}

/** Undefined when nothing is there, including when a parent directory became a file. */
function lstatOrUndefined(path: string): BigIntStats | undefined {
  try {
    return lstatSync(path, { bigint: true, throwIfNoEntry: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
    throw error;
  }
}

const billion = 1_000_000_000n;
const low32 = 0xffffffffn;

/**
 * The file is unchanged since it was staged when its mtime, size and inode match the entry, unless
 * the file was written in the same instant as the index itself: then a later write inside that
 * timestamp's granularity would go unseen, so it is hashed ("racy git").
 */
function statMatches(
  e: IndexEntry,
  st: BigIntStats,
  index: BigIntStats,
): boolean {
  const mtimeSec = Number(st.mtimeNs / billion);
  const mtimeNsec = Number(st.mtimeNs % billion);
  if (
    e.mtimeSec !== mtimeSec ||
    e.mtimeNsec !== mtimeNsec ||
    e.size !== Number(st.size & low32) ||
    e.ino !== Number(st.ino & low32)
  )
    return false;
  const indexSec = Number(index.mtimeNs / billion);
  const indexNsec = Number(index.mtimeNs % billion);
  return (
    e.mtimeSec < indexSec ||
    (e.mtimeSec === indexSec && e.mtimeNsec < indexNsec)
  );
}
