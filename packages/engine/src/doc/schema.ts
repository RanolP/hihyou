import { z } from "zod";
import { LanguageId } from "../parse/languages.js";
import { Diffset, FileStatus } from "../source/file-source.js";

export const schemaVersion = 1;

/** 1-based line, and 1-based column in UTF-16 code units, so a viewer maps straight to a GitHub line anchor. */
export const Position = z.object({
  line: z.int().min(1),
  column: z.int().min(1),
});
export type Position = z.infer<typeof Position>;

/** `end` is exclusive: the position just past the last character. */
export const Range = z.object({ start: Position, end: Position });
export type Range = z.infer<typeof Range>;

/** `node` is the tree-sitter node kind the edit applies to; absent in line mode. */
const node = z.string().optional();
export const Edit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("insert"), new: Range, node }),
  z.object({ kind: z.literal("delete"), old: Range, node }),
  /** A token whose text changed in place. */
  z.object({ kind: z.literal("update"), old: Range, new: Range, node }),
  /** A node that changed parent or order; edits inside it are reported separately. */
  z.object({ kind: z.literal("move"), old: Range, new: Range, node }),
]);
export type Edit = z.infer<typeof Edit>;

export const DiffMode = z.enum(["ast", "line", "binary"]);
export const FallbackReason = z.enum([
  "unsupported-language",
  "too-large",
  "parse-error",
]);
export type FallbackReason = z.infer<typeof FallbackReason>;

export const FileDiff = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: FileStatus,
  language: LanguageId.nullable(),
  diffMode: DiffMode,
  /** Why the file got line mode instead of ast mode. */
  fallbackReason: FallbackReason.optional(),
  /** Whitespace never produces an edit, so a whitespace-only change leaves this empty. */
  edits: z.array(Edit),
});
export type FileDiff = z.infer<typeof FileDiff>;

export const ReviewDoc = z.object({
  schemaVersion: z.literal(schemaVersion),
  diffset: Diffset,
  files: z.array(FileDiff),
});
export type ReviewDoc = z.infer<typeof ReviewDoc>;
