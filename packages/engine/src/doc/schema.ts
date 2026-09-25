import { z } from "zod";
import { LanguageId } from "../parse/languages.js";
import { Diffset, FileStatus } from "../source/file-source.js";

export const schemaVersion = 2;

/** 1-based line, and 1-based column in UTF-16 code units, so a viewer maps straight to a GitHub line anchor. */
export const Position = z.object({
  line: z.int().min(1),
  column: z.int().min(1),
});
export type Position = z.infer<typeof Position>;

/** `end` is exclusive: the position just past the last character. */
export const Range = z.object({ start: Position, end: Position });
export type Range = z.infer<typeof Range>;

/**
 * `id` is unique in the doc; an edit spanning two files appears in both under the same id, so groups refer to it once.
 * `node` is the tree-sitter node kind the edit applies to; absent in line mode.
 */
const common = { id: z.int().min(0), node: z.string().optional() };
/**
 * Set only when that side of the edit lies in another file: `from` is its base path, `to` its head path.
 * A viewer marks only the side in its own file.
 */
const across = { from: z.string().optional(), to: z.string().optional() };
export const Edit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("insert"), new: Range, ...common }),
  z.object({ kind: z.literal("delete"), old: Range, ...common }),
  /** A token whose text changed in place. */
  z.object({
    kind: z.literal("update"),
    old: Range,
    new: Range,
    ...common,
    ...across,
  }),
  /** A node that changed parent or order, or moved to another file; edits inside it are reported separately. */
  z.object({
    kind: z.literal("move"),
    old: Range,
    new: Range,
    ...common,
    ...across,
  }),
]);
export type Edit = z.infer<typeof Edit>;

/**
 * `submodule`: the entry pins another repository's revision; there is no content to diff.
 * `error`: the file could not be read or diffed; `FileDiff.error` says why, and the other files still build.
 */
export const DiffMode = z.enum(["ast", "line", "binary", "submodule", "error"]);
/** `undecodable`: bytes that differ but are not valid UTF-8, so the file is shown as binary rather than mis-decoded. */
export const FallbackReason = z.enum([
  "unsupported-language",
  "too-large",
  "parse-error",
  "undecodable",
]);
export type FallbackReason = z.infer<typeof FallbackReason>;

/**
 * Why a viewer shows the file collapsed. `generated`, `lockfile` and `snapshot`: a tool wrote it. `format-only`:
 * its text changed but its syntax did not. `moved`: every edit is a move. `renamed` and `copied`: the content
 * came across unchanged. `empty`: an added or deleted file with no content.
 */
export const FoldReason = z.enum([
  "generated",
  "lockfile",
  "snapshot",
  "binary",
  "submodule",
  "format-only",
  "moved",
  "renamed",
  "copied",
  "empty",
]);
export type FoldReason = z.infer<typeof FoldReason>;

/**
 * A structural cue that a change needs a careful read. `condition`: inside an `if`/`while`/ternary condition.
 * `operator`: an operator or keyword token changed. `error-handling`: inside try/catch/finally/throw/raise.
 * `exported-api`: the name, parameters or return type of an exported declaration, or a whole export.
 * `line-mode`: an edit in a file diffed by lines, so nothing more is known about it. `error`: the file could not be diffed.
 */
export const RiskSignal = z.enum([
  "condition",
  "operator",
  "error-handling",
  "exported-api",
  "removed-code",
  "added-code",
  "literal",
  "line-mode",
  "error",
  "moved",
  "renamed",
  "comment",
]);
export type RiskSignal = z.infer<typeof RiskSignal>;

/** `count` edits showed `signal`, worth `points`: the signal's weight times `count`, capped per signal. */
export const RiskReason = z.object({
  signal: RiskSignal,
  count: z.int().min(1),
  points: z.number().min(0),
});
export type RiskReason = z.infer<typeof RiskReason>;

/** `score` is the sum of the reasons' points; reasons are ordered by points, highest first. */
export const Risk = z.object({
  score: z.number().min(0),
  reasons: z.array(RiskReason),
});
export type Risk = z.infer<typeof Risk>;

export const FileDiff = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: FileStatus,
  language: LanguageId.nullable(),
  diffMode: DiffMode,
  /** Why the file got line or binary mode instead of ast mode. */
  fallbackReason: FallbackReason.optional(),
  /** Set exactly when `diffMode` is `error`. */
  error: z.string().optional(),
  /** Absent when the file has something to review. */
  fold: FoldReason.optional(),
  /**
   * Whitespace is never content: it produces an edit only where the syntax makes it matter (splitting or
   * joining tokens, or indentation in Python, YAML and Makefiles), so re-indenting or re-wrapping leaves this empty.
   */
  edits: z.array(Edit),
  /** Computed for folded files too; folding and risk are independent. */
  risk: Risk,
});
export type FileDiff = z.infer<typeof FileDiff>;

/**
 * Files are ordered for review: unfolded before folded, then by risk score, highest first, then by path.
 */
export const ReviewDoc = z.object({
  schemaVersion: z.literal(schemaVersion),
  diffset: Diffset,
  files: z.array(FileDiff),
});
export type ReviewDoc = z.infer<typeof ReviewDoc>;
