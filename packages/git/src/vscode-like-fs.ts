import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import type { EntryType, FileSystem } from "./io.js";

// The local disk seen the way `vscode.workspace.fs` sees it, for running the web adapter under Node in
// tests and benchmarks: whole-millisecond mtime and size only (no inode, nanoseconds or mode bits), and
// no ranged reads. It keeps `readLink`, which the vscode API lacks, so the oracle can compare symlinks.

const absent = new Set(["ENOENT", "EISDIR", "ENOTDIR"]);

async function orUndefined<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (absent.has((error as NodeJS.ErrnoException).code ?? ""))
      return undefined;
    throw error;
  }
}

function typeOf(d: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): EntryType {
  if (d.isFile()) return "file";
  if (d.isDirectory()) return "directory";
  return d.isSymbolicLink() ? "symlink" : "other";
}

export const vscodeLikeFileSystem: FileSystem = {
  readFile: (path) => orUndefined(() => readFile(path)),
  readDir: (path) =>
    orUndefined(async () =>
      (await readdir(path, { withFileTypes: true })).map((d) => ({
        name: d.name,
        type: typeOf(d),
      })),
    ),
  stat: async (path) => {
    const st = await orUndefined(() => lstat(path));
    return (
      st && {
        type: typeOf(st),
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
      }
    );
  },
  readLink: async (path) => readlink(path, { encoding: "buffer" }),
};
