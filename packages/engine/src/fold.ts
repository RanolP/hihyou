export type CollapseReason =
  | "generated"
  | "lockfile"
  | "binary"
  | "submodule"
  | "too-large"
  | "parse-error"
  | "format-only"
  | "moved";

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
  /\.min\.(?:js|css)$|\.(?:js|css)\.map$|\.generated\.\w+$|\.g\.dart$|\.pb\.go$|_pb2\.pyi?$|\.snap$/;
/** The markers generators write into their output's header: `@generated`, Go's `Code generated ... DO NOT EDIT.` */
const generatedMarker = /@generated\b|\bDO NOT EDIT\b|\bauto-?generated\b/i;

/** What made the file rather than a person, judged from its path and the head of its text. */
export function producedBy(
  path: string,
  text: string | undefined,
): "lockfile" | "generated" | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (lockfiles.has(name)) return "lockfile";
  if (/(?:^|\/)__snapshots__\//.test(path) || generatedName.test(name))
    return "generated";
  if (text !== undefined && generatedMarker.test(text.slice(0, 1024)))
    return "generated";
  return undefined;
}

/** What the diff of a readable file found, for judging whether a reviewer can skip it. */
export interface FoldFacts {
  path: string;
  /** The after text, or the before text of a deleted file. */
  text: string;
  /** Why the file fell back to a line diff, if it did. */
  fallback?: "too-large" | "parse-error";
  /** Syntax diff only: every edit in the file is a move inside it. */
  onlyMoves?: boolean;
  /** Syntax diff only: the file has no edit at all, though its text changed. */
  noEdits?: boolean;
}

/** Why the whole file should be shown folded, or undefined when it has something to read. */
export function foldReason(f: FoldFacts): CollapseReason | undefined {
  return (
    producedBy(f.path, f.text) ??
    f.fallback ??
    (f.onlyMoves ? "moved" : f.noEdits ? "format-only" : undefined)
  );
}
