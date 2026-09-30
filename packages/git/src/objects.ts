import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { type GitObject, type ObjectType, Pack } from "./pack.js";

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

/** Git's object id for `bytes` stored as a blob, the same id `git hash-object` prints. */
export function hashBlob(bytes: Uint8Array): Sha {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

/** Loose objects and packfiles under one `objects/` directory. */
export class ObjectStore {
  private packs: Pack[] = [];
  private packNames = new Set<string>();
  private readonly commits = new Map<Sha, Commit>();

  constructor(private readonly dir: string) {
    this.scanPacks();
  }

  close(): void {
    for (const pack of this.packs) pack.close();
  }

  read(sha: Sha): GitObject {
    const obj = this.tryRead(sha);
    if (!obj) throw new Error(`object ${sha} not found in ${this.dir}`);
    return obj;
  }

  tryRead(sha: Sha): GitObject | undefined {
    return (
      this.fromPacks(sha) ??
      this.loose(sha) ??
      (this.scanPacks() ? this.fromPacks(sha) : undefined)
    );
  }

  has(sha: Sha): boolean {
    const raw = Buffer.from(sha, "hex");
    return (
      this.packs.some((p) => p.find(raw) >= 0) ||
      existsSync(this.loosePath(sha))
    );
  }

  /** Full ids starting with `prefix`, at most two: enough to tell unique from ambiguous. */
  expand(prefix: string): Sha[] {
    const found = new Set<Sha>();
    for (const pack of this.packs)
      for (const sha of pack.findPrefix(prefix, 2)) found.add(sha);
    const fan = join(this.dir, prefix.slice(0, 2));
    if (existsSync(fan))
      for (const name of readdirSync(fan))
        if ((prefix.slice(0, 2) + name).startsWith(prefix))
          found.add(prefix.slice(0, 2) + name);
    return [...found].slice(0, 2);
  }

  /** Commits are immutable and small, and a history walk re-reads each one, so they are kept. */
  readCommit(sha: Sha): Commit {
    let commit = this.commits.get(sha);
    if (!commit) {
      if (this.commits.size >= 100_000) this.commits.clear();
      commit = parseCommit(sha, this.readTyped(sha, "commit"));
      this.commits.set(sha, commit);
    }
    return commit;
  }

  readTree(sha: Sha): TreeEntry[] {
    return parseTree(this.readTyped(sha, "tree"));
  }

  readBlob(sha: Sha): Uint8Array {
    return this.readTyped(sha, "blob");
  }

  /** Follows annotated tags down to the object they name. */
  peel(sha: Sha): { sha: Sha; type: ObjectType } {
    for (let depth = 0; depth < 32; depth++) {
      const obj = this.read(sha);
      if (obj.type !== "tag") return { sha, type: obj.type };
      const target = /^object ([0-9a-f]{40})$/m.exec(decode(obj.data));
      if (!target) throw new Error(`tag ${sha} names no object`);
      sha = target[1] as Sha;
    }
    throw new Error(`tag chain from ${sha} is too deep`);
  }

  private readTyped(sha: Sha, type: ObjectType): Uint8Array {
    const obj = this.read(sha);
    if (obj.type !== type)
      throw new Error(`object ${sha} is a ${obj.type}, not a ${type}`);
    return obj.data;
  }

  private fromPacks(sha: Sha): GitObject | undefined {
    const raw = Buffer.from(sha, "hex");
    for (const pack of this.packs) {
      const i = pack.find(raw);
      if (i >= 0) return pack.read(pack.offsetAt(i), (base) => this.read(base));
    }
    return undefined;
  }

  private loosePath(sha: Sha): string {
    return join(this.dir, sha.slice(0, 2), sha.slice(2));
  }

  private loose(sha: Sha): GitObject | undefined {
    let raw: Buffer;
    try {
      raw = inflateSync(readFileSync(this.loosePath(sha)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const nul = raw.indexOf(0);
    const type = raw.toString("latin1", 0, raw.indexOf(0x20));
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
  private scanPacks(): boolean {
    const packDir = join(this.dir, "pack");
    if (!existsSync(packDir)) return false;
    let added = false;
    for (const name of readdirSync(packDir)) {
      if (!name.endsWith(".idx") || this.packNames.has(name)) continue;
      const packPath = join(packDir, `${name.slice(0, -4)}.pack`);
      if (!existsSync(packPath)) continue;
      this.packs.push(Pack.open(join(packDir, name), packPath));
      this.packNames.add(name);
      added = true;
    }
    return added;
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
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const entries: TreeEntry[] = [];
  let p = 0;
  while (p < buf.length) {
    const space = buf.indexOf(0x20, p);
    const nul = buf.indexOf(0, space);
    entries.push({
      mode: Number.parseInt(buf.toString("latin1", p, space), 8),
      name: buf.toString("utf8", space + 1, nul),
      sha: buf.toString("hex", nul + 1, nul + 21),
    });
    p = nul + 21;
  }
  return entries;
}
