import type { FileDiff, FoldReason } from "./schema.js";

const lockfiles = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "composer.lock",
  "go.sum",
  "flake.lock",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "packages.lock.json",
  "gradle.lockfile",
]);

const generatedName =
  /\.min\.(?:js|css)$|\.(?:js|css)\.map$|\.generated\.\w+$|\.g\.dart$|\.pb\.go$|_pb2\.pyi?$/;
/** The markers generators write into their output's header: `@generated`, Go's `Code generated ... DO NOT EDIT.` */
const generatedMarker = /@generated\b|\bDO NOT EDIT\b|\bauto-?generated\b/i;

/** What made the file rather than a person, judged from its path and the head of its text; undefined for hand-written files. */
export function producedBy(
  path: string,
  text: string | undefined,
): "lockfile" | "snapshot" | "generated" | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (lockfiles.has(name)) return "lockfile";
  if (/(?:^|\/)__snapshots__\//.test(path) || name.endsWith(".snap"))
    return "snapshot";
  if (generatedName.test(name)) return "generated";
  if (text !== undefined && generatedMarker.test(text.slice(0, 1024)))
    return "generated";
  return undefined;
}

/** Why a reviewer can skip the file by default, or undefined when it has something to read. */
export function foldReason(
  file: Omit<FileDiff, "fold">,
  produced: ReturnType<typeof producedBy>,
): FoldReason | undefined {
  if (file.diffMode === "error") return undefined;
  if (produced) return produced;
  if (file.diffMode === "binary" || file.diffMode === "submodule")
    return file.diffMode;
  if (file.edits.length > 0)
    return file.edits.every((e) => e.kind === "move") ? "moved" : undefined;
  switch (file.status) {
    case "renamed":
    case "copied":
      return file.status;
    case "modified":
      return "format-only";
    default:
      return "empty";
  }
}
