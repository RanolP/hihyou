/** A token's tree node: a handle into the arena tree. */
export type TokenNode = number;

/**
 * Layout IR. Its semantics are prettier's document model (groups break outermost-first, `fill` packs), because
 * the output is judged byte-for-byte against prettier; what is ours is that every source token is a `Token`
 * pointing at its tree node, so the printer reports where each input token landed without re-matching text.
 *
 * The builders below are the contract; the storage is theirs. A doc is an integer handle into one flat,
 * bump-allocated buffer (a kind, flags and three slots per node), with its text, nodes and child lists in side
 * tables, so building allocates no object per doc and the printer walks integers. A JavaScript array is still a
 * doc, the concatenation of its elements, and it is kept by reference rather than copied: a caller may hand an
 * array to a builder and fill it afterwards, as when the contents must name the group around them.
 */
declare const handle: unique symbol;
export type DocHandle = number & { readonly [handle]: true };
export type Doc = DocHandle | readonly Doc[];

/** A source token (see `token`). */
export type Token = DocHandle;
/** What an `ifBreak` or `fitsExpanded` can follow: a group, or a `bestFitParenthesize` (ruff gives both a group id). */
export type GroupRef = DocHandle;

export const TOKEN = 0;
export const TEXT = 1;
export const LINE = 2;
export const GROUP = 3;
export const INDENT = 4;
export const FILL = 5;
export const LINE_SUFFIX = 6;
export const BREAK_PARENT = 7;
export const IF_BREAK = 8;
export const ALIGN = 9;
export const LINE_SUFFIX_BOUNDARY = 10;
export const BEST_FITTING = 11;
export const BEST_FIT_PARENTHESIZE = 12;
export const FITS_EXPANDED = 13;
export const GROUP_IF_BREAK = 14;

const KIND_NAMES = [
  "token",
  "text",
  "line",
  "group",
  "indent",
  "fill",
  "lineSuffix",
  "breakParent",
  "ifBreak",
  "align",
  "lineSuffixBoundary",
  "bestFitting",
  "bestFitParenthesize",
  "fitsExpanded",
  "groupIfBreak",
] as const;
export type DocKind = (typeof KIND_NAMES)[number];

// Flags, by kind.
export const SYNTHETIC = 1;
export const LITERAL = 2;
export const SOFT = 1;
export const HARD = 2;
export const COLLAPSE = 4;
export const BLANK = 8;
export const BROKEN = 1;
export const STATES = 2;
export const ALL_LINES = 1;
export const EXPANDS = 1;

/** A child slot holding no doc (an `ifBreak` without its group). */
export const NONE = -1;

const STRIDE = 4;
/** Per node: `kind | flags << 8`, then slots a, b, c. A slot holds a handle (>= 0) or, negated, a list index. */
export let buf = new Int32Array(STRIDE * 1024);
let top = 0;
/** Arrays held by slots, by index: a concatenation, fill parts, conditional states, best-fitting variants. */
export const lists: (readonly Doc[])[] = [];
export const strs: string[] = [];
export const nodes: TokenNode[] = [];
const aligns: (number | string)[] = [];

function alloc(kind: number, flags: number, a: number, b: number, c: number) {
  const at = top * STRIDE;
  if (at + STRIDE > buf.length) {
    const grown = new Int32Array(buf.length * 2);
    grown.set(buf);
    buf = grown;
  }
  buf[at] = kind | (flags << 8);
  buf[at + 1] = a;
  buf[at + 2] = b;
  buf[at + 3] = c;
  return top++ as DocHandle;
}

/** The slot value for `d`: its handle, or its array registered as a list. */
export function ref(d: Doc): number {
  if (typeof d === "number") return d;
  lists.push(d as readonly Doc[]);
  return -lists.length;
}
/** The doc a slot value stands for. */
export const deref = (r: number): Doc =>
  r >= 0 ? (r as DocHandle) : (lists[-r - 1] as readonly Doc[]);
function str(s: string): number {
  strs.push(s);
  return strs.length - 1;
}

// Handle 0 is no doc, so every doc is truthy and a slot can tell a handle from nothing.
alloc(BREAK_PARENT, 0, 0, 0, 0);

/** How many nodes the buffer holds: every handle is below it. */
export const docCount = (): number => top;

// Accessors: what a caller may read of a doc, whatever the storage.
export const kindCode = (d: DocHandle): number =>
  (buf[d * STRIDE] as number) & 0xff;
export const flagsOf = (d: DocHandle): number =>
  (buf[d * STRIDE] as number) >>> 8;
export const slotA = (d: number): number => buf[d * STRIDE + 1] as number;
export const slotB = (d: number): number => buf[d * STRIDE + 2] as number;

export const kindOf = (d: DocHandle): DocKind =>
  KIND_NAMES[kindCode(d)] as DocKind;
export const isHardLine = (d: DocHandle): boolean => (flagsOf(d) & HARD) !== 0;
export const isSoftLine = (d: DocHandle): boolean => (flagsOf(d) & SOFT) !== 0;
/** Whether a group (or groupIfBreak) is marked broken: by its builder, or by the printer's break propagation. */
const isBroken = (d: DocHandle): boolean => (flagsOf(d) & BROKEN) !== 0;
/** The contents of a group, groupIfBreak, indent, align, lineSuffix, fitsExpanded or bestFitParenthesize. */
export const contentsOf = (d: DocHandle): Doc =>
  deref(kindCode(d) === BEST_FIT_PARENTHESIZE ? slotB(d) : slotA(d));
/** A conditional group's states (see `conditionalGroup`). */
export const statesOf = (d: DocHandle): readonly Doc[] | undefined =>
  kindCode(d) === GROUP && flagsOf(d) & STATES
    ? (deref(slotB(d)) as readonly Doc[])
    : undefined;
export const partsOf = (d: DocHandle): readonly Doc[] =>
  deref(slotA(d)) as readonly Doc[];
export const variantsOf = (d: DocHandle): readonly Doc[] =>
  deref(slotA(d)) as readonly Doc[];
export const brokenOf = (d: DocHandle): Doc => deref(slotA(d));
export const flatOf = (d: DocHandle): Doc => deref(slotB(d));
export const alignOf = (d: DocHandle): number | string =>
  aligns[slotB(d)] as number | string;
/** A lineSuffix's reserved columns. */
export const reservedOf = (d: DocHandle): number => slotB(d);

/** `d` (a group without states, an indent, an align or a lineSuffix) rebuilt around `contents`, unbroken. */
export function withContents(d: DocHandle, contents: Doc): DocHandle {
  switch (kindCode(d)) {
    case GROUP:
      return group(contents);
    case INDENT:
      return indent(contents);
    case ALIGN:
      return align(alignOf(d), contents);
    case LINE_SUFFIX:
      return lineSuffix(contents, reservedOf(d));
    default:
      throw new Error(`withContents: a ${kindOf(d)} has no contents`);
  }
}

/**
 * A line with explicit flags: `SOFT` (nothing when flat, else a space), `HARD` (always breaks), and ruff's
 * `COLLAPSE` (when it breaks on a line that is still empty it prints nothing, so breaks never stack up into
 * blank lines) and `BLANK` (then adds exactly one empty line). A hard line breaks no group by itself unless it
 * collapses; `hardline` pairs one with a `breakParent`.
 */
export const lineOf = (flags: number): DocHandle => alloc(LINE, flags, 0, 0, 0);

/** A space in a flat group, a newline in a broken one. */
export const line = lineOf(0);
/** Nothing in a flat group, a newline in a broken one. */
export const softline = lineOf(SOFT);
/** Forces every enclosing group to break. */
export const breakParent = alloc(BREAK_PARENT, 0, 0, 0, 0);
export const hardline: Doc = [lineOf(HARD), breakParent];

/** Flushes pending line suffixes with a line break here, so a trailing comment never swallows what follows. */
export const lineSuffixBoundary = alloc(LINE_SUFFIX_BOUNDARY, 0, 0, 0, 0);

/** Text the formatter synthesizes, such as a space; it maps to no input range. */
export const text = (s: string): DocHandle => alloc(TEXT, 0, 0, str(s), -1);

function tokenOf(node: TokenNode, s: string, flags: number): Token {
  nodes.push(node);
  return alloc(TOKEN, flags, nodes.length - 1, str(s), -1);
}
/**
 * A source token, printed as `text`: usually its source slice, but a rule may respell it (a number's case, a
 * string's quotes), and the language's `normalize` decides whether `check` finds the meaning held. Either way
 * the node's range is where it came from.
 */
export const token = (node: TokenNode, s: string): Token => tokenOf(node, s, 0);
/**
 * A token no source token stands for, anchored to `anchor`, the nearest source node: one a rule inserted (a
 * trailing `,`, a `;`), which `normalize` must declare optional.
 */
export const synthetic = (anchor: TokenNode, s: string): Token =>
  tokenOf(anchor, s, SYNTHETIC);
/**
 * A token whose line breaks are prettier's literal lines (a template literal's text, ruff's triple-quoted
 * string): the column restarts at 0 after each one, and a width check ends at the first unless it measures
 * every line, when the last line starts the next. Otherwise the whole text counts toward one line, as prettier
 * counts a multi-line comment. It breaks no group around it; a caller that wants that adds a `breakParent`.
 */
export const literalToken = (node: TokenNode, s: string): Token =>
  tokenOf(node, s, LITERAL);

/** Printed flat when it fits in the remaining width, else broken. */
export const group = (contents: Doc, shouldBreak = false): DocHandle =>
  alloc(GROUP, shouldBreak ? BROKEN : 0, ref(contents), 0, 0);
/**
 * Prettier's conditionalGroup, `states` from most to least compact: when the first state does not fit flat, the
 * first later state that fits flat, else the last one broken. A break inside a state does not break this group.
 */
export const conditionalGroup = (
  states: readonly Doc[],
  shouldBreak = false,
): DocHandle =>
  alloc(
    GROUP,
    (shouldBreak ? BROKEN : 0) | STATES,
    ref(states[0] ?? []),
    ref(states),
    0,
  );
export const indent = (contents: Doc): DocHandle =>
  alloc(INDENT, 0, ref(contents), 0, 0);
/** Indents `contents` by `n` spaces (or by the string `n`) past the enclosing indentation, as prettier's align; `-Infinity` returns to the root indentation (prettier's dedentToRoot). */
export function align(n: number | string, contents: Doc): DocHandle {
  aligns.push(n);
  return alloc(ALIGN, 0, ref(contents), aligns.length - 1, 0);
}
/** `contents` at the enclosing indentation minus its innermost level, as prettier's dedent. */
export const dedent = (contents: Doc): DocHandle => align(-1, contents);
/** Alternating content and separator; each separator breaks only when the content after it would not fit. */
export const fill = (parts: readonly Doc[]): DocHandle =>
  alloc(FILL, 0, ref(parts), 0, 0);
/**
 * Printed at the next line break instead of here, and not measured: how a trailing comment follows a comma.
 * `reserved` columns count against the line now although the contents print later: how ruff keeps a trailing
 * comment within the width.
 */
export const lineSuffix = (contents: Doc, reserved = 0): DocHandle =>
  alloc(LINE_SUFFIX, 0, ref(contents), reserved, 0);

/**
 * Ruff's `best_fitting`: the first variant, but the last, that fits printed flat; else the last, printed broken.
 * `allLines` measures every line a variant spans rather than only the first. A break inside breaks no group around.
 */
export const bestFitting = (
  variants: readonly Doc[],
  allLines = false,
): DocHandle =>
  alloc(BEST_FITTING, allLines ? ALL_LINES : 0, ref(variants), 0, 0);
/**
 * Ruff's `best_fit_parenthesize`: `contents` flat if it fits; else between `open` and `close` on lines of its own,
 * if every line then fits; else `contents` bare, each group in it measuring itself. The node after it is the
 * indented contents of the parenthesized layout, built here once.
 */
export function bestFitParenthesize(
  open: Token,
  contents: Doc,
  close: Token,
): DocHandle {
  const c = ref(contents);
  const b = alloc(BEST_FIT_PARENTHESIZE, 0, open, c, close);
  alloc(INDENT, 0, ref([hardline, deref(c)]), 0, 0);
  return b;
}

/**
 * Ruff's `fits_expanded`: while `whenFlat` (or, without it, always) is printed flat, the group measuring this
 * counts only the text before and after it, as if `contents` were broken over lines of any width. A break
 * inside does not break the groups around; it makes the measure fail when the condition does not hold.
 */
export const fitsExpanded = (contents: Doc, whenFlat?: GroupRef): DocHandle =>
  alloc(FITS_EXPANDED, 0, ref(contents), whenFlat ?? NONE, 0);

/** `broken` when `of` (by default the innermost enclosing group) is printed broken, else `flat`. */
export const ifBreak = (
  broken: Doc,
  flat: Doc = [],
  of?: GroupRef,
): DocHandle => alloc(IF_BREAK, 0, ref(broken), ref(flat), of ?? NONE);

/** `contents` indented when `of` is printed broken (or, `negate`d, when it is flat), as prettier's indentIfBreak and ruff's `indent_if_group_breaks`. */
export const indentIfBreak = (
  contents: Doc,
  of: GroupRef,
  negate = false,
): DocHandle =>
  negate
    ? ifBreak(contents, indent(contents), of)
    : ifBreak(indent(contents), contents, of);

/**
 * Ruff's `conditional_group`: a group while `cond` is printed broken; otherwise its contents print in the mode
 * around it, unmeasured. Unlike prettier's conditionalGroup it picks no state.
 */
export const groupIfBreak = (contents: Doc, cond: GroupRef): DocHandle =>
  alloc(GROUP_IF_BREAK, 0, ref(contents), cond, 0);

/** Whether `doc` holds a forced break: a hard line, a break parent, or a group already marked broken. */
export function willBreak(doc: Doc): boolean {
  if (typeof doc !== "number") return (doc as readonly Doc[]).some(willBreak);
  const d = doc as DocHandle;
  switch (kindCode(d)) {
    case GROUP:
    case GROUP_IF_BREAK:
      return isBroken(d) || willBreak(contentsOf(d));
    case LINE:
      return isHardLine(d);
    case BREAK_PARENT:
      return true;
    case INDENT:
    case ALIGN:
    case LINE_SUFFIX:
    case BEST_FIT_PARENTHESIZE:
    case FITS_EXPANDED:
      return willBreak(contentsOf(d));
    case BEST_FITTING:
      return willBreak(variantsOf(d).at(-1) ?? []);
    case FILL:
      return partsOf(d).some(willBreak);
    case IF_BREAK:
      return willBreak(brokenOf(d)) || willBreak(flatOf(d));
    default:
      return false;
  }
}

/** Whether `d` is a concatenation (an array) rather than a single doc. */
export const isDocs = (d: Doc): d is readonly Doc[] => typeof d !== "number";

export function join(separator: Doc, docs: readonly Doc[]): Doc[] {
  const out: Doc[] = [];
  for (const [i, d] of docs.entries()) {
    if (i > 0) out.push(separator);
    out.push(d);
  }
  return out;
}
