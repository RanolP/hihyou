export type { Anchor, AstSteps, LineRange } from "./anchor.js";
export { defaultCacheBytes } from "./cache.js";
export type { Diffset } from "./diffset.js";
export type { CollapseReason } from "./fold.js";
export type {
  CodeFragment,
  FileDiff,
  LinePair,
  Side,
  SideMove,
  Span,
} from "./fragments.js";
export {
  type LanguageId,
  languageForPath,
  type SyntechsGrammarOptions,
  syntechsGrammars,
} from "./grammars.js";
export {
  type BlobId,
  type ChangedFileRef,
  createEngine,
  type Engine,
  type FormatModule,
  type Grammar,
  type GrammarLoader,
  type HighlightModule,
  type Host,
  type HostAuthor,
  type HostPreferences,
  type NodeId,
  type SerializedDiffsetId,
} from "./host.js";
export type { InterDiffset, PortResult } from "./interdiff.js";
// What a renderer needs to turn `Span.scope` into a colour.
export {
  type CompiledTheme,
  compileTheme,
  type Theme,
} from "syntechs/highlight";
export type {
  AnchorData,
  Author,
  RequestAxis,
  ReviewComment,
  ReviewThread,
  ReviewThreads,
  Verdict,
} from "./review.js";
