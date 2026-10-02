// `/`-separated absolute paths, the form `GitIO` takes; a Windows drive root is `C:/`.

const driveRoot = /^[A-Za-z]:\//;

function rootOf(path: string): string {
  if (path.startsWith("/")) return "/";
  return driveRoot.exec(path)?.[0] ?? "";
}

export const isAbsolute = (path: string) => rootOf(path) !== "";

export function normalize(path: string): string {
  const root = rootOf(path);
  const out: string[] = [];
  for (const part of path.slice(root.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return root + out.join("/");
}

/** An empty, `.` or `..` segment, which only `normalize` resolves. */
const needsNormalizing = /(?:^|\/)\.{0,2}(?:\/|$)/;

// A worktree diff joins every tracked path onto the root, and those are already normal: the fast
// path skips the split and rejoin.
export function join(...parts: string[]): string {
  const path = parts.join("/");
  return needsNormalizing.test(path.slice(rootOf(path).length))
    ? normalize(path)
    : path;
}

export const resolve = (base: string, path: string) =>
  normalize(isAbsolute(path) ? path : `${base}/${path}`);

export function dirname(path: string): string {
  const n = normalize(path);
  const root = rootOf(n);
  const slash = n.lastIndexOf("/");
  return slash < root.length ? root : n.slice(0, slash);
}
