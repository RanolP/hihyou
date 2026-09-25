import type { LanguageId } from "./languages.js";

// Parser-neutral: nothing outside parse/ sees the parser library, so replacing it touches only this directory.

/** Plain-object syntax tree, materialized once so matching never crosses into the parser. Offsets are UTF-16 code units into the source text. */
export interface SyntaxNode {
  /** Preorder index; a node's descendants are exactly ids `id + 1 .. id + size - 1`. */
  id: number;
  kind: string;
  /**
   * Token text for leaves (comments with whitespace runs collapsed), "" for inner nodes.
   * Whitespace between tokens never appears in a tree, so it never takes part in a diff.
   */
  label: string;
  start: number;
  end: number;
  parent: SyntaxNode | undefined;
  children: SyntaxNode[];
  height: number;
  size: number;
}

export interface SyntaxTree {
  /** Preorder; `nodes[0]` is the root. */
  nodes: SyntaxNode[];
  /** Characters covered by ERROR nodes, for the caller's parse-error threshold. */
  errorChars: number;
}

export interface SyntaxParser {
  parse(lang: LanguageId, text: string): Promise<SyntaxTree>;
}
