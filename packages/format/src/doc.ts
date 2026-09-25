import type { FormatNode } from "./tree.js";

/**
 * Layout IR. Its semantics are prettier's document model (groups break outermost-first, `fill` packs), because
 * the output is judged byte-for-byte against prettier; what is ours is that every source token is a `Token`
 * pointing at its tree node, so the printer reports where each input token landed without re-matching text.
 * New kinds (prettier's align, lineSuffix, conditionalGroup, ...) are added as the rules come to need them.
 */
export type Doc =
  | Token
  | Text
  | Line
  | Group
  | Indent
  | Fill
  | LineSuffix
  | BreakParent
  | IfBreak
  | readonly Doc[];

/**
 * A source token, printed as `text`: usually its source slice, but a rule may normalize it (a number's case, a
 * comment's trailing spaces). Either way the node's range is where it came from.
 */
export interface Token {
  readonly k: "token";
  readonly node: FormatNode;
  readonly text: string;
}
/** Text the formatter synthesizes, such as a space; it maps to no input range. */
export interface Text {
  readonly k: "text";
  readonly text: string;
}
/** A space (or nothing when `soft`) in a flat group, a newline in a broken one; `hard` always breaks. */
export interface Line {
  readonly k: "line";
  readonly soft: boolean;
  readonly hard: boolean;
}
/** Printed flat when it fits in the remaining width, else broken. */
export interface Group {
  readonly k: "group";
  readonly contents: Doc;
  break: boolean;
}
export interface Indent {
  readonly k: "indent";
  readonly contents: Doc;
}
/** Alternating content and separator; each separator breaks only when the content after it would not fit. */
export interface Fill {
  readonly k: "fill";
  readonly parts: readonly Doc[];
  /** Parts before this index are already printed; the printer advances it instead of slicing. */
  readonly from?: number;
}
/** Printed at the next line break instead of here, and not measured: how a trailing comment follows a comma. */
export interface LineSuffix {
  readonly k: "lineSuffix";
  readonly contents: Doc;
}
/** `broken` when `group` (by default the innermost enclosing group) is printed broken, else `flat`. */
export interface IfBreak {
  readonly k: "ifBreak";
  readonly broken: Doc;
  readonly flat: Doc;
  readonly group: Group | undefined;
}
/** Forces every enclosing group to break. */
export interface BreakParent {
  readonly k: "breakParent";
}

export const line: Line = { k: "line", soft: false, hard: false };
export const softline: Line = { k: "line", soft: true, hard: false };
export const breakParent: BreakParent = { k: "breakParent" };
export const hardline: Doc = [
  { k: "line", soft: false, hard: true },
  breakParent,
];

export const text = (text: string): Text => ({ k: "text", text });
export const token = (node: FormatNode, text: string): Token => ({
  k: "token",
  node,
  text,
});
export const group = (contents: Doc, shouldBreak = false): Group => ({
  k: "group",
  contents,
  break: shouldBreak,
});
export const indent = (contents: Doc): Indent => ({ k: "indent", contents });
export const fill = (parts: readonly Doc[]): Fill => ({ k: "fill", parts });
export const lineSuffix = (contents: Doc): LineSuffix => ({
  k: "lineSuffix",
  contents,
});

export const ifBreak = (broken: Doc, flat: Doc = [], of?: Group): IfBreak => ({
  k: "ifBreak",
  broken,
  flat,
  group: of,
});

export function join(separator: Doc, docs: readonly Doc[]): Doc[] {
  const out: Doc[] = [];
  for (const [i, d] of docs.entries()) {
    if (i > 0) out.push(separator);
    out.push(d);
  }
  return out;
}
