import type { Language } from "./language.js";
import { parseSubtree } from "./parser.js";
import {
  type RawTree,
  type SyntaxTree,
  visibleTree,
  walkTree,
} from "./tree.js";

export {
  type GrammarMeta,
  type Language,
  type LexFn,
  loadLanguage,
} from "./language.js";
export type { ExternalScanner, Lexer } from "./lexer.js";
export {
  type RawTree,
  type SyntaxNode,
  type SyntaxTree,
  syntaxTree,
} from "./tree.js";

/** Parses `text` into the SyntaxTree that packages/engine diffs: the visible nodes, layout-only JSX text dropped. */
export function parse(lang: Language, text: string): SyntaxTree {
  return visibleTree(parseRaw(lang, text));
}

/** The visible tree before layout-only JSX text is dropped, with the MISSING nodes marked. */
export function parseRaw(lang: Language, text: string): RawTree {
  return walkTree(lang, parseSubtree(lang, text), text);
}
