import type { Language } from "./language.js";
import { parseSubtree } from "./parser.js";
import { type RawTree, type SyntaxTree, syntaxTree, walkTree } from "./tree.js";

export type { Language } from "./language.js";
export type { ExternalScanner, Lexer } from "./lexer.js";
export type { RawTree, SyntaxNode, SyntaxTree } from "./tree.js";

/** Parses `text` in the engine's SyntaxTree shape: what packages/engine builds from web-tree-sitter. */
export function parse(lang: Language, text: string): SyntaxTree {
  return syntaxTree(parseRaw(lang, text));
}

/** The visible tree before layout-only JSX text is dropped, with the MISSING nodes marked. */
export function parseRaw(lang: Language, text: string): RawTree {
  return walkTree(lang, parseSubtree(lang, text), text);
}
