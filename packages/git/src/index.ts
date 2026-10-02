export type { ConfigEntry, Remote } from "./config.js";
export {
  type LocalDiffsetId,
  type LocalHost,
  type LocalHostOptions,
  localHost,
} from "./host.js";
export type {
  DirEntry,
  EntryType,
  FileStat,
  FileSystem,
  GitIO,
  Inflate,
  RandomAccessFile,
  Sha1,
} from "./io.js";
export {
  type Commit,
  type GitObject,
  hashBlob,
  type ObjectType,
  type Sha,
  type TreeEntry,
} from "./objects.js";
export type { Head, Ref } from "./refs.js";
export { openRepo, type Repo } from "./repo.js";
export type {
  ChangedFile,
  ChangeStatus,
  DiffOptions,
  FileMap,
} from "./tree-diff.js";
export type { WorktreeSnapshot } from "./worktree.js";
