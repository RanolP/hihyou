export type FileTreeNode<T extends { path: string }> =
  | { kind: "folder"; name: string; path: string; children: FileTreeNode<T>[] }
  | { kind: "file"; name: string; file: T };

/**
 * `files` as a folder tree the way VS Code's compact folders draw one: a folder whose only child is a folder
 * shares its row (`src/panel`). Folders sort before files, each by name.
 */
export function fileTree<T extends { path: string }>(
  files: readonly T[],
): FileTreeNode<T>[] {
  interface Dir {
    dirs: Map<string, Dir>;
    files: T[];
  }
  const root: Dir = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    parts.pop();
    let dir = root;
    for (const part of parts) {
      let next = dir.dirs.get(part);
      if (!next) dir.dirs.set(part, (next = { dirs: new Map(), files: [] }));
      dir = next;
    }
    dir.files.push(file);
  }

  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const build = (dir: Dir, prefix: string): FileTreeNode<T>[] => [
    ...[...dir.dirs]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, sub]): FileTreeNode<T> => {
        let path = prefix + name;
        for (
          let [only] = sub.dirs;
          only && sub.files.length === 0 && sub.dirs.size === 1;
          [only] = sub.dirs
        ) {
          const [childName, child] = only;
          name = `${name}/${childName}`;
          path = `${path}/${childName}`;
          sub = child;
        }
        return { kind: "folder", name, path, children: build(sub, `${path}/`) };
      }),
    ...dir.files
      .map((file): FileTreeNode<T> => ({
        kind: "file",
        name: file.path.slice(file.path.lastIndexOf("/") + 1),
        file,
      }))
      .sort((a, b) => byName(a.name, b.name)),
  ];
  return build(root, "");
}
