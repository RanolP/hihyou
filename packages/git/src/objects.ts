import { concat, fromHex, latin1, toHex, utf8 } from "./bytes.js";
import type { GitIO, Sha1 } from "./io.js";
import { type GitObject, type ObjectType, Pack } from "./pack.js";
import { join } from "./path.js";

export type { GitObject, ObjectType } from "./pack.js";

/** A 40-hex SHA-1 object id. */
export type Sha = string;

export interface Commit {
  sha: Sha;
  tree: Sha;
  parents: Sha[];
  author: string;
  committer: string;
  /** Committer time, seconds since the epoch. */
  time: number;
  message: string;
}

export interface TreeEntry {
  name: string;
  /** Git's file mode as a number: 0o100644, 0o100755, 0o120000 (symlink), 0o40000 (tree), 0o160000 (submodule). */
  mode: number;
  sha: Sha;
}

export const TREE = 0o40000;
export const GITLINK = 0o160000;
export const SYMLINK = 0o120000;
export const emptyBlob: Sha = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

const encoder = new TextEncoder();

/** Git's object id for `bytes` stored as a blob, the same id `git hash-object` prints. */
export function hashBlob(sha1: Sha1, bytes: Uint8Array): Promise<Sha> {
  return sha1(concat([encoder.encode(`blob ${bytes.length}\0`), bytes]));
}

/** Loose objects and packfiles under one `objects/` directory. */
export class ObjectStore {
  private packs: Pack[] = [];
  private packNames = new Set<string>();
  private readonly commits = new Map<Sha, Commit>();

  private constructor(
    private readonly io: GitIO,
    private readonly dir: string,
  ) {}

  static async open(io: GitIO, dir: string): Promise<ObjectStore> {
    const store = new ObjectStore(io, dir);
    await store.scanPacks();
    return store;
  }

  close(): void {
    for (const pack of this.packs) pack.close();
  }

  async read(sha: Sha): Promise<GitObject> {
    const obj = await this.tryRead(sha);
    if (!obj) throw new Error(`object ${sha} not found in ${this.dir}`);
    return obj;
  }

  async tryRead(sha: Sha): Promise<GitObject | undefined> {
    return (
      (await this.fromPacks(sha)) ??
      (await this.loose(sha)) ??
      ((await this.scanPacks()) ? this.fromPacks(sha) : undefined)
    );
  }

  async has(sha: Sha): Promise<boolean> {
    const raw = fromHex(sha);
    return (
      this.packs.some((p) => p.find(raw) >= 0) ||
      (await this.io.fs.stat(this.loosePath(sha))) !== undefined
    );
  }

  /** Full ids starting with `prefix`, at most two: enough to tell unique from ambiguous. */
  async expand(prefix: string): Promise<Sha[]> {
    const found = new Set<Sha>();
    for (const pack of this.packs)
      for (const sha of pack.findPrefix(prefix, 2)) found.add(sha);
    const fan = prefix.slice(0, 2);
    for (const { name } of (await this.io.fs.readDir(join(this.dir, fan))) ??
      [])
      if ((fan + name).startsWith(prefix)) found.add(fan + name);
    return [...found].slice(0, 2);
  }

  /** Commits are immutable and small, and a history walk re-reads each one, so they are kept. */
  async readCommit(sha: Sha): Promise<Commit> {
    let commit = this.commits.get(sha);
    if (!commit) {
      if (this.commits.size >= 100_000) this.commits.clear();
      commit = parseCommit(sha, await this.readTyped(sha, "commit"));
      this.commits.set(sha, commit);
    }
    return commit;
  }

  async readTree(sha: Sha): Promise<TreeEntry[]> {
    return parseTree(await this.readTyped(sha, "tree"));
  }

  readBlob(sha: Sha): Promise<Uint8Array> {
    return this.readTyped(sha, "blob");
  }

  /** Follows annotated tags down to the object they name. */
  async peel(sha: Sha): Promise<{ sha: Sha; type: ObjectType }> {
    for (let depth = 0; depth < 32; depth++) {
      const obj = await this.read(sha);
      if (obj.type !== "tag") return { sha, type: obj.type };
      const target = /^object ([0-9a-f]{40})$/m.exec(decode(obj.data));
      if (!target) throw new Error(`tag ${sha} names no object`);
      sha = target[1] as Sha;
    }
    throw new Error(`tag chain from ${sha} is too deep`);
  }

  private async readTyped(sha: Sha, type: ObjectType): Promise<Uint8Array> {
    const obj = await this.read(sha);
    if (obj.type !== type)
      throw new Error(`object ${sha} is a ${obj.type}, not a ${type}`);
    return obj.data;
  }

  private fromPacks(sha: Sha): Promise<GitObject> | undefined {
    const raw = fromHex(sha);
    for (const pack of this.packs) {
      const i = pack.find(raw);
      if (i >= 0) return pack.read(pack.offsetAt(i), (base) => this.read(base));
    }
    return undefined;
  }

  private loosePath(sha: Sha): string {
    return join(this.dir, sha.slice(0, 2), sha.slice(2));
  }

  private async loose(sha: Sha): Promise<GitObject | undefined> {
    const file = await this.io.fs.readFile(this.loosePath(sha));
    if (!file) return undefined;
    // A loose object file is exactly one zlib stream.
    const raw = await this.io.inflate(file);
    const nul = raw.indexOf(0);
    const type = latin1(raw, 0, raw.indexOf(0x20));
    if (
      nul < 0 ||
      !(
        type === "commit" ||
        type === "tree" ||
        type === "blob" ||
        type === "tag"
      )
    )
      throw new Error(`loose object ${sha} has a malformed header`);
    return { type, data: raw.subarray(nul + 1) };
  }

  /** Picks up packs written since the last scan; true when any were new. */
  private async scanPacks(): Promise<boolean> {
    const packDir = join(this.dir, "pack");
    const entries = await this.io.fs.readDir(packDir);
    if (!entries) return false;
    const names = new Set(entries.map((e) => e.name));
    const fresh = entries
      .map((e) => e.name)
      .filter(
        (name) =>
          name.endsWith(".idx") &&
          !this.packNames.has(name) &&
          names.has(`${name.slice(0, -4)}.pack`),
      );
    const opened = await Promise.all(
      fresh.map((name) =>
        Pack.open(
          this.io,
          join(packDir, name),
          join(packDir, `${name.slice(0, -4)}.pack`),
        ),
      ),
    );
    for (const [i, pack] of opened.entries()) {
      if (this.packNames.has(fresh[i] as string)) continue;
      this.packNames.add(fresh[i] as string);
      this.packs.push(pack);
    }
    return fresh.length > 0;
  }
}

const decoder = new TextDecoder();
const decode = (bytes: Uint8Array) => decoder.decode(bytes);

export function parseCommit(sha: Sha, data: Uint8Array): Commit {
  const text = decode(data);
  const headerEnd = text.indexOf("\n\n");
  const header = headerEnd < 0 ? text : text.slice(0, headerEnd);
  const commit: Commit = {
    sha,
    tree: "",
    parents: [],
    author: "",
    committer: "",
    time: 0,
    message: headerEnd < 0 ? "" : text.slice(headerEnd + 2),
  };
  for (const line of header.split("\n")) {
    const space = line.indexOf(" ");
    const key = line.slice(0, space);
    const value = line.slice(space + 1);
    if (key === "tree") commit.tree = value;
    else if (key === "parent") commit.parents.push(value);
    else if (key === "author") commit.author = value;
    else if (key === "committer") {
      commit.committer = value;
      commit.time = Number(/ (\d+) [+-]\d{4}$/.exec(value)?.[1] ?? 0);
    }
  }
  if (!commit.tree) throw new Error(`commit ${sha} has no tree`);
  return commit;
}

export function parseTree(data: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let p = 0;
  while (p < data.length) {
    const space = data.indexOf(0x20, p);
    const nul = data.indexOf(0, space);
    let mode = 0;
    for (let i = p; i < space; i++) mode = mode * 8 + (data[i] as number) - 48;
    entries.push({
      mode,
      name: utf8(data, space + 1, nul),
      sha: toHex(data, nul + 1, nul + 21),
    });
    p = nul + 21;
  }
  return entries;
}
