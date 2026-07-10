/**
 * File tree for the changed-files sidebar: nested folders with VS Code-style
 * compaction (single-child folder chains collapse into one `a/b/c` row).
 */

export interface TreeFile {
  type: 'file';
  name: string;
  path: string;
}

export interface TreeDir {
  type: 'dir';
  /** Display name; may span compacted segments like `src/core`. */
  name: string;
  path: string;
  dirs: TreeDir[];
  files: TreeFile[];
}

export function buildFileTree(paths: string[]): TreeDir {
  const root: TreeDir = { type: 'dir', name: '', path: '', dirs: [], files: [] };
  for (const path of paths) {
    const segments = path.split('/');
    let dir = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i];
      let next = dir.dirs.find((d) => d.name === name);
      if (!next) {
        next = {
          type: 'dir',
          name,
          path: segments.slice(0, i + 1).join('/'),
          dirs: [],
          files: [],
        };
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push({ type: 'file', name: segments[segments.length - 1], path });
  }
  compact(root);
  sortTree(root);
  return root;
}

/** Collapse folders that contain exactly one subfolder and no files. */
function compact(dir: TreeDir): void {
  for (let i = 0; i < dir.dirs.length; i++) {
    let child = dir.dirs[i];
    while (child.dirs.length === 1 && child.files.length === 0) {
      const only = child.dirs[0];
      child = {
        ...only,
        name: `${child.name}/${only.name}`,
      };
      dir.dirs[i] = child;
    }
    compact(child);
  }
}

function sortTree(dir: TreeDir): void {
  dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
  dir.files.sort((a, b) => a.name.localeCompare(b.name));
  dir.dirs.forEach(sortTree);
}

/** All file paths under a directory node. */
export function treeFilePaths(dir: TreeDir): string[] {
  return [
    ...dir.files.map((f) => f.path),
    ...dir.dirs.flatMap(treeFilePaths),
  ];
}
