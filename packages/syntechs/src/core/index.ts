import type { Language } from "./language.js";
import { parseSubtree } from "./parser.js";
import type { Tree } from "./arena.js";
import { buildTree } from "./tree.js";

export {
  type GrammarMeta,
  type Language,
  type LexFn,
  loadLanguage,
} from "./language.js";
export { NO_NODE, type Tree } from "./arena.js";
export type { ExternalScanner, Lexer } from "./lexer.js";

/** Parses `text` into the arena tree the diff reads: the visible nodes, layout-only JSX text dropped. */
export function parseTree(lang: Language, text: string): Tree {
  return buildTree(lang, parseSubtree(lang, text), text);
}
