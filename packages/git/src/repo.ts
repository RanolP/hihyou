import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type ConfigEntry,
  configBool,
  configValue,
  readConfig,
  type Remote,
  remotesOf,
} from "./config.js";
import {
  type Commit,
  type GitObject,
  ObjectStore,
  type Sha,
  type TreeEntry,
} from "./objects.js";
import { type Head, type Ref, RefStore } from "./refs.js";
import { mergeBase, resolveRev } from "./rev.js";
import {
  type ChangedFile,
  type DiffOptions,
  diffFileMaps,
  diffTrees,
  flattenTree,
} from "./tree-diff.js";
import { snapshotWorktree, type WorktreeSnapshot } from "./worktree.js";

export interface Repo {
  /** This worktree's git dir: `.git`, or `.git/worktrees/<name>` for a linked worktree. */
  readonly gitDir: string;
  /** Where objects, shared refs and config live; equals `gitDir` outside linked worktrees. */
  readonly commonDir: string;
  /** Undefined for a bare repository. */
  readonly workTree: string | undefined;
  readonly config: readonly ConfigEntry[];

  head(): Head;
  resolveRev(spec: string): Sha;
  listRefs(): Ref[];
  mergeBase(a: string, b: string): Sha | undefined;
  readRemotes(): Remote[];

  readObject(sha: Sha): GitObject;
  readCommit(sha: Sha): Commit;
  readTree(sha: Sha): TreeEntry[];
  /** A blob from the object store, or working-tree bytes a worktree diff hashed under that id. */
  readBlob(sha: Sha): Uint8Array;

  /** Changes from `a` to `b`, each a commit or tree id; undefined is the empty tree. */
  diffTrees(
    a: Sha | undefined,
    b: Sha | undefined,
    options?: DiffOptions,
  ): ChangedFile[];
  /** Commit to commit, by rev spec. */
  diffRevs(a: string, b: string, options?: DiffOptions): ChangedFile[];
  /** HEAD to the index: what `git diff --cached` shows. */
  diffStaged(options?: DiffOptions): ChangedFile[];
  /** The index to the working tree: what `git diff` shows. */
  diffUnstaged(options?: DiffOptions): ChangedFile[];
  /** HEAD to the working tree: what `git diff HEAD` shows. Untracked files are not included. */
  diffWorktree(options?: DiffOptions): ChangedFile[];
  /** The index and the working tree as file maps, read once for callers that need several diffs. */
  snapshot(): WorktreeSnapshot;

  /** Releases open pack file handles. */
  close(): void;
}

/** Working-tree bytes kept after hashing, oldest dropped first past this total. */
const hashedCacheBytes = 256 * 1024 * 1024;

/**
 * The repository containing `path`, found the way git finds it: the nearest `.git` directory or
 * `gitdir:` file walking up, or `path` itself when it is a bare repository.
 */
export function openRepo(path: string): Repo {
  const found = discover(resolve(path));
  if (!found) throw new Error(`not a git repository: ${path}`);
  const { gitDir } = found;
  const commonFile = join(gitDir, "commondir");
  const commonDir = existsSync(commonFile)
    ? resolve(gitDir, readFileSync(commonFile, "utf8").trim())
    : gitDir;
  const config = readConfig(join(commonDir, "config"));
  const format = configValue(config, "extensions.objectformat");
  if (format && format.toLowerCase() !== "sha1")
    throw new Error(`${commonDir}: object format ${format} is not supported`);
  const coreWorktree = configValue(config, "core.worktree");
  const workTree =
    found.workTree === undefined
      ? undefined
      : coreWorktree
        ? resolve(gitDir, coreWorktree)
        : found.workTree;

  const objects = new ObjectStore(join(commonDir, "objects"));
  const refs = new RefStore(gitDir, commonDir);
  const hashed = new Map<Sha, Uint8Array>();
  let hashedBytes = 0;
  const remember = (sha: Sha, bytes: Uint8Array) => {
    if (hashed.has(sha)) return;
    hashed.set(sha, bytes);
    hashedBytes += bytes.length;
    for (const [key, value] of hashed) {
      if (hashedBytes <= hashedCacheBytes) break;
      hashed.delete(key);
      hashedBytes -= value.length;
    }
  };
  const submodules = new Map<string, Repo>();

  const headTree = () => {
    const sha = refs.head().sha;
    return sha ? objects.readCommit(sha).tree : undefined;
  };
  const snapshot = (): WorktreeSnapshot => {
    if (workTree === undefined)
      throw new Error(`${gitDir} is a bare repository: it has no working tree`);
    return snapshotWorktree({
      workTree,
      indexPath: join(gitDir, "index"),
      fileMode: configBool(config, "core.filemode", true),
      onHashed: remember,
      submoduleHead: (dir) => {
        let sub = submodules.get(dir);
        if (!sub) {
          sub = openRepo(dir);
          submodules.set(dir, sub);
        }
        return sub.head().sha;
      },
    });
  };
  const treeOf = (sha: Sha | undefined) => {
    if (sha === undefined) return undefined;
    const obj = objects.peel(sha);
    return obj.type === "commit" ? objects.readCommit(obj.sha).tree : obj.sha;
  };

  const repo: Repo = {
    gitDir,
    commonDir,
    workTree,
    config,
    head: () => refs.head(),
    resolveRev: (spec) => resolveRev(refs, objects, spec),
    listRefs: () => refs.list(),
    mergeBase: (a, b) =>
      mergeBase(objects, repo.resolveRev(a), repo.resolveRev(b)),
    readRemotes: () => remotesOf(config),
    readObject: (sha) => objects.read(sha),
    readCommit: (sha) => objects.readCommit(sha),
    readTree: (sha) => objects.readTree(sha),
    readBlob: (sha) => hashed.get(sha) ?? objects.readBlob(sha),
    diffTrees: (a, b, options) =>
      diffTrees(objects, treeOf(a), treeOf(b), options),
    diffRevs: (a, b, options) =>
      repo.diffTrees(repo.resolveRev(a), repo.resolveRev(b), options),
    diffStaged: (options) =>
      diffFileMaps(flattenTree(objects, headTree()), snapshot().index, options),
    diffUnstaged: (options) => {
      const s = snapshot();
      return diffFileMaps(s.index, s.worktree, options);
    },
    diffWorktree: (options) =>
      diffFileMaps(
        flattenTree(objects, headTree()),
        snapshot().worktree,
        options,
      ),
    snapshot,
    close: () => {
      objects.close();
      for (const sub of submodules.values()) sub.close();
    },
  };
  return repo;
}

function discover(
  start: string,
): { gitDir: string; workTree: string | undefined } | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    const st = statSync(dotGit, { throwIfNoEntry: false });
    if (st?.isDirectory()) return { gitDir: dotGit, workTree: dir };
    if (st?.isFile()) {
      const m = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, "utf8"));
      if (m)
        return { gitDir: resolve(dir, (m[1] as string).trim()), workTree: dir };
    }
    if (
      existsSync(join(dir, "HEAD")) &&
      existsSync(join(dir, "objects")) &&
      existsSync(join(dir, "refs"))
    )
      return { gitDir: dir, workTree: undefined };
    if (dirname(dir) === dir) return undefined;
  }
}
