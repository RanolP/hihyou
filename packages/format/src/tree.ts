/**
 * The tree the formatter reads: the structural subset that the engine's plain-object tree and a tree-sitter
 * tree both satisfy, so neither has to be converted. Offsets are UTF-16 code units into the source text.
 */
export interface FormatNode {
  readonly kind: string;
  /** False for anonymous tokens the grammar spells literally (punctuation, keywords). */
  readonly named: boolean;
  readonly field: string | undefined;
  /**
   * Inserted by the parser to recover from a syntax error, so it stands for no source text. Zero width alone
   * does not tell: a TypeScript statement's semicolon can be zero width and still real.
   */
  readonly missing: boolean;
  readonly start: number;
  readonly end: number;
  readonly children: readonly FormatNode[];
}
