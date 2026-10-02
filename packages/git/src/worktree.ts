import { type IndexEntry, parseIndex } from "./git-index.js";
import type { FileStat, FileSystem, Sha1 } from "./io.js";
import { GITLINK, hashBlob, type Sha, SYMLINK } from "./objects.js";
import { join } from "./path.js";
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
  fs: FileSystem;
  sha1: Sha1;
  workTree: string;
  indexPath: string;
  /** `core.filemode`: when false, the executable bit on disk is ignored, as on Windows. */
  fileMode: boolean;
  /** Receives the bytes of every file hashed, so a later `readBlob` of its id needs no re-read. */
  onHashed(sha: Sha, bytes: Uint8Array): void;
  /** HEAD of the repository checked out at a submodule path, if it has one. */
  submoduleHead(path: string): Promise<Sha | undefined>;
}

/**
 * Files looked at concurrently. A browser file system answers each stat over a message channel, so
 * one at a time would cost a round trip per tracked file.
 */
const concurrency = 64;

type Disk = { mode: number; sha: Sha } | undefined;

/**
 * The index and the working tree as two file maps. A file whose stat matches its index entry is
 * taken at the index's id unread, as `git status` does; only the rest is read and hashed.
 */
export async function snapshotWorktree(
  options: WorktreeOptions,
): Promise<WorktreeSnapshot> {
  const [raw, indexStat] = await Promise.all([
    options.fs.readFile(options.indexPath),
    options.fs.stat(options.indexPath),
  ]);
  if (!raw || !indexStat)
    return { index: new Map(), worktree: new Map(), conflicted: [] };
  const index: FileMap = new Map();
  const conflicted = new Set<string>();
  const paths: string[] = [];
  const disk: (Disk | (() => Promise<Disk>))[] = [];
  for (const e of parseIndex(raw)) {
    if (e.stage !== 0) {
      if (!conflicted.has(e.path)) {
        conflicted.add(e.path);
        paths.push(e.path);
        disk.push(() => onDisk(options, e, indexStat, true));
      }
      continue;
    }
    if (!e.intentToAdd) index.set(e.path, { mode: e.mode, sha: e.sha });
    paths.push(e.path);
    disk.push(
      e.skipWorktree || e.assumeValid
        ? { mode: e.mode, sha: e.sha }
        : () => onDisk(options, e, indexStat, e.intentToAdd),
    );
  }
  let next = 0;
  const worker = async () => {
    while (next < disk.length) {
      const i = next++;
      const job = disk[i];
      if (typeof job === "function") disk[i] = await job();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const worktree: FileMap = new Map();
  for (const [i, path] of paths.entries()) {
    const d = disk[i] as Disk;
    if (d) worktree.set(path, d);
  }
  return { index, worktree, conflicted: [...conflicted] };
}

async function onDisk(
  options: WorktreeOptions,
  e: IndexEntry,
  indexStat: FileStat,
  forceHash: boolean,
): Promise<Disk> {
  const { fs } = options;
  const full = join(options.workTree, e.path);
  if (e.mode === GITLINK) {
    // An uninitialized submodule is an empty directory, which git shows as unchanged.
    if (!(await fs.stat(join(full, ".git"))))
      return { mode: e.mode, sha: e.sha };
    return { mode: e.mode, sha: (await options.submoduleHead(full)) ?? e.sha };
  }
  const st = await fs.stat(full);
  if (!st || !(st.type === "file" || st.type === "symlink")) return undefined;
  const mode =
    st.type === "symlink"
      ? SYMLINK
      : (!options.fileMode || st.executable === undefined) && e.mode !== SYMLINK
        ? e.mode
        : st.executable
          ? 0o100755
          : 0o100644;
  if (!forceHash && mode === e.mode && statMatches(e, st, indexStat))
    return { mode, sha: e.sha };
  let bytes: Uint8Array | undefined;
  if (st.type === "symlink") {
    // Reading through the link would hash the target's content, not the link.
    if (!fs.readLink) return { mode, sha: e.sha };
    bytes = await fs.readLink(full);
  } else {
    bytes = await fs.readFile(full);
    if (!bytes) return undefined;
  }
  const sha = await hashBlob(options.sha1, bytes);
  if (sha !== e.sha) options.onHashed(sha, bytes);
  return { mode, sha };
}

const low32 = 2 ** 32;

/**
 * The file is unchanged since it was staged when its mtime, size and inode match the entry, unless
 * the file was written in the same instant as the index itself: then a later write inside that
 * timestamp's granularity would go unseen, so it is hashed ("racy git").
 *
 * A file system that reports only milliseconds (`vscode.workspace.fs`) compares at that granularity,
 * with the same rule: a file whose millisecond is not strictly before the index's is hashed.
 */
function statMatches(e: IndexEntry, st: FileStat, index: FileStat): boolean {
  if (e.size !== st.size % low32) return false;
  if (st.ino !== undefined && e.ino !== st.ino % low32) return false;
  if (st.mtime && index.mtime) {
    if (e.mtimeSec !== st.mtime.sec || e.mtimeNsec !== st.mtime.nsec)
      return false;
    return (
      e.mtimeSec < index.mtime.sec ||
      (e.mtimeSec === index.mtime.sec && e.mtimeNsec < index.mtime.nsec)
    );
  }
  const entryMs = e.mtimeSec * 1000 + Math.floor(e.mtimeNsec / 1e6);
  return (
    entryMs === Math.floor(st.mtimeMs) && entryMs < Math.floor(index.mtimeMs)
  );
}
