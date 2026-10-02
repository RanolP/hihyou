import type { EntryType, FileSystem } from "@hihyou/git";
import * as vscode from "vscode";

// `vscode.FileSystemError.code` values that mean "nothing readable here", which the port reports as undefined.
const absent = new Set([
  "FileNotFound",
  "FileIsADirectory",
  "FileNotADirectory",
]);

async function orUndefined<T>(read: () => Thenable<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof vscode.FileSystemError && absent.has(error.code))
      return undefined;
    throw error;
  }
}

function entryType(type: vscode.FileType): EntryType {
  if (type & vscode.FileType.SymbolicLink) return "symlink";
  if (type & vscode.FileType.Directory) return "directory";
  return type & vscode.FileType.File ? "file" : "other";
}

/**
 * git's absolute paths as paths on `folder`'s scheme and authority. vscode's API has no link reading, no
 * ranged reads and no mode bits, so `readLink` and `openFile` are left out and packs are read whole.
 *
 * Repository discovery climbs from the folder towards `/`; every lookup whose parent is a strict ancestor of
 * the folder answers "nothing here", so the repository is the folder's own and nothing above it is probed.
 * Paths elsewhere (a worktree's gitdir outside the folder) stay readable.
 */
export function workspaceFileSystem(folder: vscode.Uri): FileSystem {
  const root = folder.path.replace(/\/+$/, "");
  const aboveRoot = (path: string) => {
    const parent = path.slice(0, path.lastIndexOf("/"));
    return parent.length < root.length && root.startsWith(`${parent}/`);
  };
  const fs = vscode.workspace.fs;
  const uri = (path: string) => folder.with({ path });
  return {
    readFile: async (path) =>
      aboveRoot(path) ? undefined : orUndefined(() => fs.readFile(uri(path))),
    readDir: async (path) =>
      aboveRoot(path)
        ? undefined
        : (await orUndefined(() => fs.readDirectory(uri(path))))?.map(
            ([name, type]) => ({ name, type: entryType(type) }),
          ),
    stat: async (path) => {
      if (aboveRoot(path)) return undefined;
      const st = await orUndefined(() => fs.stat(uri(path)));
      return (
        st && {
          type: entryType(st.type),
          size: st.size,
          mtimeMs: Math.floor(st.mtime),
        }
      );
    },
  };
}
