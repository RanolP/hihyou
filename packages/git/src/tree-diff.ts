import {
  emptyBlob,
  GITLINK,
  type ObjectStore,
  type Sha,
  TREE,
  type TreeEntry,
} from "./objects.js";

export type ChangeStatus = "added" | "deleted" | "modified" | "renamed";

export interface ChangedFile {
  path: string;
  /** Set on a rename only. */
  oldPath?: string;
  status: ChangeStatus;
  oldSha?: Sha;
  newSha?: Sha;
  /** The new side's mode, or the old side's for a deletion. */
  mode: number;
  oldMode?: number;
  /** Mode 160000: the ids name commits of another repository, not blobs. */
  submodule?: true;
}

export interface DiffOptions {
  /** Pair a deleted and an added file with the same blob id as a rename. Default true. */
  renames?: boolean;
}

/** One side of a flat diff: path to the entry it holds. */
export type FileMap = Map<string, { mode: number; sha: Sha }>;

/**
 * Files that differ between two trees. Subtrees with equal ids are never read, so a diff costs the
 * changed part of the trees, not their size. An undefined side is the empty tree.
 */
export async function diffTrees(
  objects: ObjectStore,
  a: Sha | undefined,
  b: Sha | undefined,
  options: DiffOptions = {},
): Promise<ChangedFile[]> {
  const out: ChangedFile[] = [];
  const read = async (sha: Sha | undefined) =>
    new Map((sha ? await objects.readTree(sha) : []).map((e) => [e.name, e]));
  const emitAll = async (path: string, e: TreeEntry, side: "old" | "new") => {
    if (e.mode === TREE) {
      for (const child of await objects.readTree(e.sha))
        await emitAll(`${path}/${child.name}`, child, side);
    } else out.push(side === "old" ? deleted(path, e) : added(path, e));
  };
  const walk = async (
    prefix: string,
    ta: Sha | undefined,
    tb: Sha | undefined,
  ) => {
    const [ea, eb] = await Promise.all([read(ta), read(tb)]);
    for (const [name, x] of ea) {
      const path = prefix + name;
      const y = eb.get(name);
      if (!y) {
        await emitAll(path, x, "old");
        continue;
      }
      if (x.sha === y.sha && x.mode === y.mode) continue;
      const xTree = x.mode === TREE;
      const yTree = y.mode === TREE;
      if (xTree && yTree) await walk(`${path}/`, x.sha, y.sha);
      else if (xTree || yTree || x.mode === GITLINK || y.mode === GITLINK) {
        await emitAll(path, x, "old");
        await emitAll(path, y, "new");
      } else out.push(modified(path, x, y));
    }
    for (const [name, y] of eb)
      if (!ea.has(name)) await emitAll(prefix + name, y, "new");
  };
  await walk("", a, b);
  return finish(out, options);
}

/** Every file under a tree, recursively, keyed by its path. */
export async function flattenTree(
  objects: ObjectStore,
  tree: Sha | undefined,
): Promise<FileMap> {
  const out: FileMap = new Map();
  const walk = async (prefix: string, sha: Sha) => {
    for (const e of await objects.readTree(sha)) {
      if (e.mode === TREE) await walk(`${prefix}${e.name}/`, e.sha);
      else out.set(prefix + e.name, { mode: e.mode, sha: e.sha });
    }
  };
  if (tree) await walk("", tree);
  return out;
}

/** Files that differ between two flat snapshots (a tree, the index, the working tree). */
export function diffFileMaps(
  a: FileMap,
  b: FileMap,
  options: DiffOptions = {},
): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const [path, x] of a) {
    const y = b.get(path);
    if (!y) out.push(deleted(path, x));
    else if (x.sha === y.sha && x.mode === y.mode) continue;
    else if ((x.mode === GITLINK) !== (y.mode === GITLINK))
      out.push(deleted(path, x), added(path, y));
    else out.push(modified(path, x, y));
  }
  for (const [path, y] of b) if (!a.has(path)) out.push(added(path, y));
  return finish(out, options);
}

type Side = { mode: number; sha: Sha };

const submodule = (mode: number) =>
  mode === GITLINK ? { submodule: true as const } : {};

const added = (path: string, e: Side): ChangedFile => ({
  path,
  status: "added",
  newSha: e.sha,
  mode: e.mode,
  ...submodule(e.mode),
});

const deleted = (path: string, e: Side): ChangedFile => ({
  path,
  status: "deleted",
  oldSha: e.sha,
  mode: e.mode,
  ...submodule(e.mode),
});

const modified = (path: string, x: Side, y: Side): ChangedFile => ({
  path,
  status: "modified",
  oldSha: x.sha,
  newSha: y.sha,
  mode: y.mode,
  ...(x.mode !== y.mode && { oldMode: x.mode }),
  ...submodule(y.mode),
});

function finish(changes: ChangedFile[], options: DiffOptions): ChangedFile[] {
  const out = options.renames === false ? changes : pairRenames(changes);
  return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/**
 * Exact renames only: a deleted and an added file holding the same blob. Among several deleted
 * candidates the one with the same file name wins, as git prefers. Empty files are never paired,
 * since every empty file shares one id.
 */
function pairRenames(changes: ChangedFile[]): ChangedFile[] {
  const sources = new Map<Sha, ChangedFile[]>();
  for (const c of changes)
    if (c.status === "deleted" && !c.submodule && c.oldSha !== emptyBlob) {
      const list = sources.get(c.oldSha as Sha) ?? [];
      list.push(c);
      sources.set(c.oldSha as Sha, list);
    }
  if (sources.size === 0) return changes;
  const paired = new Set<ChangedFile>();
  const renames: ChangedFile[] = [];
  for (const c of changes) {
    if (c.status !== "added" || c.submodule) continue;
    const list = sources.get(c.newSha as Sha);
    if (!list || list.length === 0) continue;
    const name = baseName(c.path);
    const i = Math.max(
      0,
      list.findIndex((d) => baseName(d.path) === name),
    );
    const source = list.splice(i, 1)[0] as ChangedFile;
    paired.add(source).add(c);
    renames.push({
      path: c.path,
      oldPath: source.path,
      status: "renamed",
      oldSha: source.oldSha as Sha,
      newSha: c.newSha as Sha,
      mode: c.mode,
      ...(source.mode !== c.mode && { oldMode: source.mode }),
    });
  }
  return [...changes.filter((c) => !paired.has(c)), ...renames];
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
