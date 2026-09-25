import type { LanguageId } from "./languages.js";

// Parser-neutral: nothing outside parse/ sees the parser library, so replacing it touches only this directory.

/** Plain-object syntax tree, materialized once so matching never crosses into the parser. Offsets are UTF-16 code units into the source text. */
export interface SyntaxNode {
  /** Preorder index; a node's descendants are exactly ids `id + 1 .. id + size - 1`. */
  id: number;
  kind: string;
  /** False for anonymous tokens the grammar spells literally (punctuation, keywords); they carry no meaning of their own. */
  named: boolean;
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
  /** `nodes[id]`, throwing when `id` is not in this tree. */
  node(id: number): SyntaxNode;
}

export function syntaxTree(
  nodes: SyntaxNode[],
  errorChars: number,
): SyntaxTree {
  return {
    nodes,
    errorChars,
    node(id) {
      const n = nodes[id];
      if (!n)
        throw new RangeError(
          `no syntax node ${id} in a tree of ${nodes.length} nodes`,
        );
      return n;
    },
  };
}

export interface SyntaxParser {
  parse(lang: LanguageId, text: string): Promise<SyntaxTree>;
}
