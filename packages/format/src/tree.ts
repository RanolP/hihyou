/**
 * The tree the formatter reads: the structural subset that the engine's plain-object tree and a tree-sitter
 * tree both satisfy, so neither has to be converted. Offsets are UTF-16 code units into the source text.
 */
export interface FormatNode {
  readonly kind: string;
  /** False for anonymous tokens the grammar spells literally (punctuation, keywords). */
  readonly named: boolean;
  readonly field: string | undefined;
  readonly start: number;
  readonly end: number;
  readonly children: readonly FormatNode[];
}
