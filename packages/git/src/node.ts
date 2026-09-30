import { createHash } from "node:crypto";
import {
  closeSync,
  type Dirent,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { inflateSync } from "node:zlib";
import type { EntryType, FileSystem, GitIO } from "./io.js";
import { openRepo as openWith, type Repo } from "./repo.js";

// Synchronous calls behind the async ports: a worktree diff stats every tracked file, and the thread
// pool round trip of `fs/promises` costs more per call than the stat itself.

const absent = new Set(["ENOENT", "EISDIR", "ENOTDIR"]);

function orUndefined<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (absent.has((error as NodeJS.ErrnoException).code ?? ""))
      return undefined;
    throw error;
  }
}

const typeOf = (
  d:
    | Dirent
    | { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean },
): EntryType =>
  d.isFile()
    ? "file"
    : d.isDirectory()
      ? "directory"
      : d.isSymbolicLink()
        ? "symlink"
        : "other";

const billion = 1_000_000_000n;
const million = 1_000_000n;

export const nodeFileSystem: FileSystem = {
  readFile: async (path) => orUndefined(() => readFileSync(path)),
  readDir: async (path) =>
    orUndefined(() =>
      readdirSync(path, { withFileTypes: true }).map((d) => ({
        name: d.name,
        type: typeOf(d),
      })),
    ),
  stat: async (path) => {
    const st = orUndefined(() =>
      lstatSync(path, { bigint: true, throwIfNoEntry: false }),
    );
    if (!st) return undefined;
    return {
      type: typeOf(st),
      size: Number(st.size),
      mtimeMs: Number(st.mtimeNs / million),
      mtime: {
        sec: Number(st.mtimeNs / billion),
        nsec: Number(st.mtimeNs % billion),
      },
      ino: Number(st.ino & 0xffffffffn),
      executable: (st.mode & 0o100n) !== 0n,
    };
  },
  readLink: async (path) => readlinkSync(path, { encoding: "buffer" }),
  openFile: async (path) => {
    const fd = openSync(path, "r");
    return {
      size: fstatSync(fd).size,
      read: async (offset, length) => {
        const buf = Buffer.allocUnsafe(length);
        readSync(fd, buf, 0, length, offset);
        return buf;
      },
      close: () => closeSync(fd),
    };
  },
};

export const nodeIO: GitIO = {
  fs: nodeFileSystem,
  // One output chunk of the known size, instead of 16 KiB chunks concatenated afterwards.
  inflate: async (bytes, size) =>
    inflateSync(
      bytes,
      size === undefined ? {} : { chunkSize: Math.max(64, size + 1) },
    ),
  sha1: async (bytes) => createHash("sha1").update(bytes).digest("hex"),
};

/** The repository containing `path` on the local disk; a relative path is taken from the current directory. */
export function openRepo(path: string, io: GitIO = nodeIO): Promise<Repo> {
  const absolute = resolve(path);
  return openWith(sep === "\\" ? absolute.replaceAll("\\", "/") : absolute, io);
}
