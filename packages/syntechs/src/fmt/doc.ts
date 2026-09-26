import type { FormatNode } from "./tree.js";

/**
 * A token's tree node: a handle into the arena tree. `FormatNode` is the legacy adapter's (legacy.ts), for the
 * JS and Python rules that still read node objects; drop it once they move to handles.
 */
export type TokenNode = number | FormatNode;

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
  | Align
  | LineSuffixBoundary
  | BestFitting
  | BestFitParenthesize
  | FitsExpanded
  | GroupIfBreak
  | readonly Doc[];

/**
 * A source token, printed as `text`: usually its source slice, but a rule may respell it (a number's case, a
 * string's quotes), and the language's `normalize` decides whether `check` finds the meaning held. Either way
 * the node's range is where it came from. A `synthetic` token is one a rule inserted (a trailing `,`, a `;`), which
 * `normalize` must declare optional; its node is the source node it sits next to.
 */
export interface Token {
  readonly k: "token";
  readonly node: TokenNode;
  readonly text: string;
  readonly synthetic?: true;
  /**
   * Its line breaks are prettier's literal lines (a template literal's text, ruff's triple-quoted string): the
   * column restarts at 0 after each one, and a width check ends at the first unless it measures every line, when
   * the last line starts the next. Otherwise the whole text counts toward one line, as prettier counts a
   * multi-line comment. It breaks no group around it; a caller that wants that adds a `breakParent`.
   */
  readonly literal?: boolean;
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
  /**
   * Ruff's line: when it breaks on a line that is still empty it prints nothing, so breaks never stack up into
   * blank lines; `blank` then adds exactly one empty line.
   */
  readonly collapse?: boolean;
  readonly blank?: boolean;
}
/** Printed flat when it fits in the remaining width, else broken. */
export interface Group {
  readonly k: "group";
  readonly contents: Doc;
  break: boolean;
  /**
   * Prettier's conditionalGroup: when `contents` (the first state) does not fit flat, the first later state that
   * fits flat, else the last one broken. A break inside a state does not break this group.
   */
  readonly expandedStates?: readonly Doc[];
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
  /** Columns counted against the line now although the contents print later: how ruff keeps a trailing comment within the width. */
  readonly reserved?: number;
}
/**
 * What an `ifBreak` or `fitsExpanded` can follow: a group, or a `bestFitParenthesize`, which counts as broken
 * when it wraps its contents in parentheses (ruff gives both a group id).
 */
export type GroupRef = Group | BestFitParenthesize;

/** `broken` when `group` (by default the innermost enclosing group) is printed broken, else `flat`. */
export interface IfBreak {
  readonly k: "ifBreak";
  readonly broken: Doc;
  readonly flat: Doc;
  readonly group: GroupRef | undefined;
}
/** Indents `contents` by `n` spaces (or by the string `n`) past the enclosing indentation, as prettier's align; `-Infinity` returns to the root indentation (prettier's dedentToRoot). */
export interface Align {
  readonly k: "align";
  readonly n: number | string;
  readonly contents: Doc;
}
/** Flushes pending line suffixes with a line break here, so a trailing comment never swallows what follows. */
export interface LineSuffixBoundary {
  readonly k: "lineSuffixBoundary";
}
/**
 * Ruff's `best_fitting`: the first variant, but the last, that fits printed flat; else the last, printed broken.
 * `allLines` measures every line a variant spans rather than only the first. A break inside breaks no group around.
 */
export interface BestFitting {
  readonly k: "bestFitting";
  readonly variants: readonly Doc[];
  readonly allLines: boolean;
}
/**
 * Ruff's `best_fit_parenthesize`: `contents` flat if it fits; else between `open` and `close` on lines of its own,
 * if every line then fits; else `contents` bare, each group in it measuring itself.
 */
export interface BestFitParenthesize {
  readonly k: "bestFitParenthesize";
  readonly open: Token;
  readonly contents: Doc;
  readonly close: Token;
}
/**
 * Ruff's `fits_expanded`: while `whenFlat` (or, without it, always) is printed flat, the group measuring this
 * counts only the text before and after it, as if `contents` were broken over lines of any width. A break
 * inside does not break the groups around; it makes the measure fail when the condition does not hold.
 */
export interface FitsExpanded {
  readonly k: "fitsExpanded";
  readonly contents: Doc;
  readonly whenFlat: GroupRef | undefined;
  /** Set by the printer: `contents` holds a hard break. */
  expands?: boolean;
}
/**
 * Ruff's `conditional_group`: a group while `cond` is printed broken; otherwise its contents print in the mode
 * around it, unmeasured. Unlike prettier's conditionalGroup (a `Group` with `expandedStates`) it picks no state.
 */
export interface GroupIfBreak {
  readonly k: "groupIfBreak";
  readonly contents: Doc;
  readonly cond: GroupRef;
  break: boolean;
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

export const lineSuffixBoundary: LineSuffixBoundary = {
  k: "lineSuffixBoundary",
};

export const text = (text: string): Text => ({ k: "text", text });
export const token = (node: TokenNode, text: string): Token => ({
  k: "token",
  node,
  text,
});
/** A token no source token stands for, anchored to `anchor`, the nearest source node. */
export const synthetic = (anchor: TokenNode, text: string): Token => ({
  k: "token",
  node: anchor,
  text,
  synthetic: true,
});
/** A token whose line breaks are literal (see `Token.literal`). */
export const literalToken = (node: TokenNode, text: string): Token => ({
  k: "token",
  node,
  text,
  literal: true,
});
export const group = (contents: Doc, shouldBreak = false): Group => ({
  k: "group",
  contents,
  break: shouldBreak,
});
/** Prettier's conditionalGroup: `states` from most to least compact (see `Group.expandedStates`). */
export const conditionalGroup = (
  states: readonly Doc[],
  shouldBreak = false,
): Group => ({
  k: "group",
  contents: states[0] ?? [],
  break: shouldBreak,
  expandedStates: states,
});
export const indent = (contents: Doc): Indent => ({ k: "indent", contents });
export const align = (n: number | string, contents: Doc): Align => ({
  k: "align",
  n,
  contents,
});
/** `contents` at the enclosing indentation minus its innermost level, as prettier's dedent. */
export const dedent = (contents: Doc): Align => align(-1, contents);
export const fill = (parts: readonly Doc[]): Fill => ({ k: "fill", parts });
export const lineSuffix = (contents: Doc): LineSuffix => ({
  k: "lineSuffix",
  contents,
});

export const bestFitting = (
  variants: readonly Doc[],
  allLines = false,
): BestFitting => ({ k: "bestFitting", variants, allLines });
export const bestFitParenthesize = (
  open: Token,
  contents: Doc,
  close: Token,
): BestFitParenthesize => ({
  k: "bestFitParenthesize",
  open,
  contents,
  close,
});

export const fitsExpanded = (
  contents: Doc,
  whenFlat?: GroupRef,
): FitsExpanded => ({
  k: "fitsExpanded",
  contents,
  whenFlat,
});

export const ifBreak = (
  broken: Doc,
  flat: Doc = [],
  of?: GroupRef,
): IfBreak => ({
  k: "ifBreak",
  broken,
  flat,
  group: of,
});

/** `contents` indented when `of` is printed broken (or, `negate`d, when it is flat), as prettier's indentIfBreak and ruff's `indent_if_group_breaks`. */
export const indentIfBreak = (
  contents: Doc,
  of: GroupRef,
  negate = false,
): IfBreak =>
  negate
    ? ifBreak(contents, indent(contents), of)
    : ifBreak(indent(contents), contents, of);

export const groupIfBreak = (contents: Doc, cond: GroupRef): GroupIfBreak => ({
  k: "groupIfBreak",
  contents,
  cond,
  break: false,
});

/** Whether `doc` holds a forced break: a hard line, a break parent, or a group already marked broken. */
export function willBreak(doc: Doc): boolean {
  if (isDocs(doc)) return doc.some(willBreak);
  switch (doc.k) {
    case "group":
    case "groupIfBreak":
      return doc.break || willBreak(doc.contents);
    case "line":
      return doc.hard;
    case "breakParent":
      return true;
    case "indent":
    case "align":
    case "lineSuffix":
    case "bestFitParenthesize":
    case "fitsExpanded":
      return willBreak(doc.contents);
    case "bestFitting":
      return willBreak(doc.variants.at(-1) ?? []);
    case "fill":
      return doc.parts.some(willBreak);
    case "ifBreak":
      return willBreak(doc.broken) || willBreak(doc.flat);
    default:
      return false;
  }
}

/** `Array.isArray` narrows to `any[]`, which leaves a `readonly Doc[]` inside the union; this narrows both ways. */
export const isDocs = (d: Doc): d is readonly Doc[] => Array.isArray(d);

export function join(separator: Doc, docs: readonly Doc[]): Doc[] {
  const out: Doc[] = [];
  for (const [i, d] of docs.entries()) {
    if (i > 0) out.push(separator);
    out.push(d);
  }
  return out;
}
