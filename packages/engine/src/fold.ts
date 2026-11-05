export type CollapseReason =
  | "generated"
  | "lockfile"
  | "binary"
  | "submodule"
  | "too-large"
  | "parse-error"
  | "format-only"
  | "moved"
  | "deleted";

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
  "Package.resolved",
  "packages.lock.json",
  "gradle.lockfile",
]);

const generatedName =
  /\.min\.(?:js|css)$|\.(?:js|css)\.map$|\.generated\.\w+$|\.g\.dart$|\.pb\.go$|_pb2\.pyi?$/;
/** The markers generators write into their output's header: `@generated`, Go's `Code generated ... DO NOT EDIT.` */
const generatedMarker = /@generated\b|\bDO NOT EDIT\b|\bauto-?generated\b/i;

/** What made the file rather than a person, judged from its path and the head of its text. */
export function producedBy(
  path: string,
  text: string | undefined,
): "lockfile" | "generated" | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (lockfiles.has(name)) return "lockfile";
  if (generatedName.test(name)) return "generated";
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
  /** Syntax diff only: the file has no changed row to show, though its text changed. */
  noEdits?: boolean;
  /** The file is gone: GitHub folds a deletion, whose every line is red, until asked. */
  deleted?: boolean;
  /** Added plus removed lines. */
  changedLines?: number;
}

/** Why the whole file should be shown folded, or undefined when it has something to read. */
export function foldReason(f: FoldFacts): CollapseReason | undefined {
  const produced = producedBy(f.path, f.text);
  return (
    // A lockfile edit of a few lines, such as a version pin, is the proof the pin took, so it reads open.
    (produced === "lockfile" && (f.changedLines ?? Infinity) <= 10
      ? undefined
      : produced) ??
    (f.deleted ? "deleted" : undefined) ??
    // A large file's line diff already shows only its changed hunks, so a small diff reads open.
    (f.fallback === "too-large" && (f.changedLines ?? Infinity) > 400
      ? f.fallback
      : undefined) ??
    (f.onlyMoves ? "moved" : f.noEdits ? "format-only" : undefined)
  );
}
