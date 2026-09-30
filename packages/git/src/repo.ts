import {
  type ConfigEntry,
  configBool,
  configValue,
  readConfig,
  type Remote,
  remotesOf,
} from "./config.js";
import { type GitIO, readText } from "./io.js";
import {
  type Commit,
  type GitObject,
  ObjectStore,
  type Sha,
  type TreeEntry,
} from "./objects.js";
import { dirname, isAbsolute, join, normalize, resolve } from "./path.js";
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
  /** What the repository was opened with. */
  readonly io: GitIO;

  head(): Promise<Head>;
  resolveRev(spec: string): Promise<Sha>;
  listRefs(): Promise<Ref[]>;
  mergeBase(a: string, b: string): Promise<Sha | undefined>;
  readRemotes(): Remote[];

  readObject(sha: Sha): Promise<GitObject>;
  readCommit(sha: Sha): Promise<Commit>;
  readTree(sha: Sha): Promise<TreeEntry[]>;
  /** A blob from the object store, or working-tree bytes a worktree diff hashed under that id. */
  readBlob(sha: Sha): Promise<Uint8Array>;

  /** Changes from `a` to `b`, each a commit or tree id; undefined is the empty tree. */
  diffTrees(
    a: Sha | undefined,
    b: Sha | undefined,
    options?: DiffOptions,
  ): Promise<ChangedFile[]>;
  /** Commit to commit, by rev spec. */
  diffRevs(a: string, b: string, options?: DiffOptions): Promise<ChangedFile[]>;
  /** HEAD to the index: what `git diff --cached` shows. */
  diffStaged(options?: DiffOptions): Promise<ChangedFile[]>;
  /** The index to the working tree: what `git diff` shows. */
  diffUnstaged(options?: DiffOptions): Promise<ChangedFile[]>;
  /** HEAD to the working tree: what `git diff HEAD` shows. Untracked files are not included. */
  diffWorktree(options?: DiffOptions): Promise<ChangedFile[]>;
  /** The index and the working tree as file maps, read once for callers that need several diffs. */
  snapshot(): Promise<WorktreeSnapshot>;

  /** Releases open pack file handles. */
  close(): void;
}

/** Working-tree bytes kept after hashing, oldest dropped first past this total. */
const hashedCacheBytes = 256 * 1024 * 1024;

/**
 * The repository containing `path`, found the way git finds it: the nearest `.git` directory or
 * `gitdir:` file walking up, or `path` itself when it is a bare repository. `path` is absolute and
 * `/`-separated, as every path `io` receives.
 */
export async function openRepo(path: string, io: GitIO): Promise<Repo> {
  if (!isAbsolute(path))
    throw new Error(`openRepo needs an absolute path, got ${path}`);
  const { fs } = io;
  const found = await discover(io, normalize(path));
  if (!found) throw new Error(`not a git repository: ${path}`);
  const { gitDir } = found;
  const common = await readText(fs, join(gitDir, "commondir"));
  const commonDir =
    common === undefined ? gitDir : resolve(gitDir, common.trim());
  const config = await readConfig(fs, join(commonDir, "config"));
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

  const objects = await ObjectStore.open(io, join(commonDir, "objects"));
  const refs = new RefStore(fs, gitDir, commonDir);
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
  const submodules = new Map<string, Promise<Repo>>();

  const headTree = async () => {
    const sha = (await refs.head()).sha;
    return sha ? (await objects.readCommit(sha)).tree : undefined;
  };
  const snapshot = async (): Promise<WorktreeSnapshot> => {
    if (workTree === undefined)
      throw new Error(`${gitDir} is a bare repository: it has no working tree`);
    return snapshotWorktree({
      fs,
      sha1: io.sha1,
      workTree,
      indexPath: join(gitDir, "index"),
      fileMode: configBool(config, "core.filemode", true),
      onHashed: remember,
      submoduleHead: async (dir) => {
        let sub = submodules.get(dir);
        if (!sub) {
          sub = openRepo(dir, io);
          submodules.set(dir, sub);
        }
        return (await (await sub).head()).sha;
      },
    });
  };
  const treeOf = async (sha: Sha | undefined) => {
    if (sha === undefined) return undefined;
    const obj = await objects.peel(sha);
    return obj.type === "commit"
      ? (await objects.readCommit(obj.sha)).tree
      : obj.sha;
  };

  const repo: Repo = {
    gitDir,
    commonDir,
    workTree,
    config,
    io,
    head: () => refs.head(),
    resolveRev: (spec) => resolveRev(refs, objects, spec),
    listRefs: () => refs.list(),
    mergeBase: async (a, b) =>
      mergeBase(objects, await repo.resolveRev(a), await repo.resolveRev(b)),
    readRemotes: () => remotesOf(config),
    readObject: (sha) => objects.read(sha),
    readCommit: (sha) => objects.readCommit(sha),
    readTree: (sha) => objects.readTree(sha),
    readBlob: async (sha) => hashed.get(sha) ?? objects.readBlob(sha),
    diffTrees: async (a, b, options) => {
      const [ta, tb] = await Promise.all([treeOf(a), treeOf(b)]);
      return diffTrees(objects, ta, tb, options);
    },
    diffRevs: async (a, b, options) => {
      const [ra, rb] = await Promise.all([
        repo.resolveRev(a),
        repo.resolveRev(b),
      ]);
      return repo.diffTrees(ra, rb, options);
    },
    diffStaged: async (options) => {
      const [head, s] = await Promise.all([
        headTree().then((t) => flattenTree(objects, t)),
        snapshot(),
      ]);
      return diffFileMaps(head, s.index, options);
    },
    diffUnstaged: async (options) => {
      const s = await snapshot();
      return diffFileMaps(s.index, s.worktree, options);
    },
    diffWorktree: async (options) => {
      const [head, s] = await Promise.all([
        headTree().then((t) => flattenTree(objects, t)),
        snapshot(),
      ]);
      return diffFileMaps(head, s.worktree, options);
    },
    snapshot,
    close: () => {
      objects.close();
      for (const sub of submodules.values())
        sub.then(
          (r) => r.close(),
          () => {},
        );
    },
  };
  return repo;
}

async function discover(
  io: GitIO,
  start: string,
): Promise<{ gitDir: string; workTree: string | undefined } | undefined> {
  const { fs } = io;
  for (let dir = start; ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    const st = await fs.stat(dotGit);
    if (st?.type === "directory") return { gitDir: dotGit, workTree: dir };
    if (st?.type === "file") {
      const m = /^gitdir: (.+)$/m.exec((await readText(fs, dotGit)) ?? "");
      if (m)
        return { gitDir: resolve(dir, (m[1] as string).trim()), workTree: dir };
    }
    const [head, objects, refs] = await Promise.all(
      ["HEAD", "objects", "refs"].map((name) => fs.stat(join(dir, name))),
    );
    if (head && objects && refs) return { gitDir: dir, workTree: undefined };
    if (dirname(dir) === dir) return undefined;
  }
}
