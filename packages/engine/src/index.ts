export { type BuildOptions, buildReviewDoc } from "./doc/build.js";
export {
  DiffMode,
  Edit,
  FallbackReason,
  FileDiff,
  FoldReason,
  Position,
  Range,
  ReviewDoc,
  schemaVersion,
} from "./doc/schema.js";
export { defaultMatchOptions, type MatchOptions } from "./match/matcher.js";
export { LanguageId, languageForPath } from "./parse/languages.js";
export {
  createSyntaxParser,
  type GrammarLocator,
  type SyntaxParserOptions,
} from "./parse/parser.js";
export type { SyntaxParser } from "./parse/tree.js";
export {
  type ChangedFile,
  Diffset,
  type FileSource,
  FileStatus,
  type Side,
} from "./source/file-source.js";
export { memorySource } from "./source/memory.js";
export {
  diffsetFromCommit,
  diffsetFromPr,
  diffsetFromRange,
  emptyRevision,
  type Vcs,
  vcsFileSource,
} from "./source/vcs.js";
