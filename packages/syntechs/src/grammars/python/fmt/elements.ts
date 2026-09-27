import {
  BLANK,
  BROKEN,
  COLLAPSE,
  close,
  closeBestFitParenthesize,
  closeVariant,
  GROUP,
  GROUP_IF_BROKEN,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  LINE_SUFFIX,
  open,
  openBestFitParenthesize,
  openBestFitting,
  openFitsExpanded,
  openIndentIfBreak,
  openReservedSuffix,
  openVariant,
  SOFT,
  sBreakParent,
  sLine,
  sLiteral,
  sRuffLine,
  sText,
  sToken,
} from "../../../fmt/stream.js";

// Ruff's formatter shape over the linear stream (`fmt/stream.ts`): a rule builds `Format`s, closures that write
// format elements into a `Buffer` (ruff's `format_with`), and `emit` writes them into the stream. A part is built
// once and may be written several times, into several variants of a best-fitting (ruff's `memoized`), which
// matters because building marks comments formatted. A buffer other than the stream reads a part without
// printing it: `willBreak` (ruff's `will_break` on a memoized part) and `removeSoftLines` (ruff's
// `RemoveSoftLinesBuffer`) are buffers.

export { BLANK, COLLAPSE, HARD, SOFT };

/** Writes format elements into `b`. Arrays of them are a sequence. */
export type Format = Element | readonly Format[];
export type Element = (b: Buffer) => void;
/** A source token, or a synthetic one anchored to a node. */
export type Token = Element;

/** A group (or a best-fit-parenthesize) other elements ask the mode of: `k`, its stream interval once written. */
export interface GroupRef {
  k: number;
}
export type Group = Element & GroupRef;

/** Ruff's `Buffer`: what a format element does, per destination. */
export interface Buffer {
  token(node: number, s: string, synthetic: boolean): void;
  literal(node: number, s: string): void;
  text(s: string): void;
  line(flags: number): void;
  breakParent(): void;
  group(g: GroupRef, contents: Format, shouldBreak: boolean): void;
  indent(contents: Format): void;
  lineSuffix(contents: Format, reserved: number): void;
  bestFitting(variants: readonly Format[], allLines: boolean): void;
  bestFitParenthesize(
    g: GroupRef,
    open: Format,
    contents: Format,
    close: Format,
  ): void;
  fitsExpanded(contents: Format, whenFlat: GroupRef | undefined): void;
  ifBreak(broken: Format, flat: Format, of: GroupRef | undefined): void;
  indentIfBreak(contents: Format, of: GroupRef): void;
  groupIfBreak(contents: Format, cond: GroupRef): void;
}

export function put(b: Buffer, d: Format): void {
  if (typeof d === "function") d(b);
  else for (const x of d) put(b, x);
}

/** The interval of a group already written, which an element asking its mode refers to. */
function written(g: GroupRef): number {
  if (g.k < 0)
    throw new Error("python: an element asks the mode of a group not yet written");
  return g.k;
}

/** The stream itself. */
const stream: Buffer = {
  token: (node, s, synthetic) => sToken(node, s, synthetic),
  literal: (node, s) => sLiteral(node, s),
  text: (s) => sText(s),
  line(flags) {
    if (flags & (COLLAPSE | BLANK)) sRuffLine(flags);
    else sLine(flags & (SOFT | HARD));
  },
  breakParent: () => sBreakParent(),
  group(g, contents, shouldBreak) {
    g.k = open(GROUP, -1, shouldBreak ? BROKEN : 0);
    put(stream, contents);
    close();
  },
  indent(contents) {
    open(INDENT);
    put(stream, contents);
    close();
  },
  lineSuffix(contents, reserved) {
    if (reserved > 0) openReservedSuffix(reserved);
    else open(LINE_SUFFIX);
    put(stream, contents);
    close();
  },
  bestFitting(variants, allLines) {
    const k = openBestFitting(allLines);
    for (const variant of variants) {
      const v = openVariant(k);
      put(stream, variant);
      closeVariant(v);
    }
    close();
  },
  bestFitParenthesize(g, open0, contents, close0) {
    const k = openBestFitParenthesize(() => put(stream, open0));
    g.k = k;
    put(stream, contents);
    closeBestFitParenthesize(k, () => put(stream, close0));
  },
  fitsExpanded(contents, whenFlat) {
    openFitsExpanded(whenFlat ? written(whenFlat) : -1);
    put(stream, contents);
    close();
  },
  ifBreak(broken, flat, of) {
    const ref = of ? written(of) : -1;
    open(IF_BROKEN, ref);
    put(stream, broken);
    close();
    open(IF_FLAT, ref);
    put(stream, flat);
    close();
  },
  indentIfBreak(contents, of) {
    openIndentIfBreak(written(of));
    put(stream, contents);
    close();
  },
  groupIfBreak(contents, cond) {
    open(GROUP_IF_BROKEN, written(cond));
    put(stream, contents);
    close();
  },
};

/** Writes `d` into the stream. */
export const emit = (d: Format): void => put(stream, d);

export const token =
  (node: number, s: string): Token =>
  (b) =>
    b.token(node, s, false);
/** A token the source does not have, anchored to `anchor`. */
export const synthetic =
  (anchor: number, s: string): Token =>
  (b) =>
    b.token(anchor, s, true);
/** A token whose line breaks print as they are, the column restarting after the last. */
export const literalToken =
  (node: number, s: string): Token =>
  (b) =>
    b.literal(node, s);
export const text =
  (s: string): Element =>
  (b) =>
    b.text(s);
/** A line: `SOFT` (nothing when flat) or a space when flat, `HARD` always breaking; `COLLAPSE` and `BLANK` are ruff's. */
export const lineOf =
  (flags: number): Element =>
  (b) =>
    b.line(flags);
/** Breaks every enclosing group. */
export const breakParent: Element = (b) => b.breakParent();

/** Printed flat when it fits in the remaining width, else broken. `contents` may be filled after this is built. */
export function group(contents: Format, shouldBreak = false): Group {
  const g = ((b: Buffer) => b.group(g, contents, shouldBreak)) as Group;
  g.k = -1;
  return g;
}
export const indent =
  (contents: Format): Element =>
  (b) =>
    b.indent(contents);
/** Printed at the next line break; `reserved` columns count against the line now (ruff's trailing comments). */
export const lineSuffix =
  (contents: Format, reserved = 0): Element =>
  (b) =>
    b.lineSuffix(contents, reserved);
/** Ruff's `best_fitting`: the first variant but the last that fits flat (`allLines`: on every line), else the last broken. */
export const bestFitting =
  (variants: readonly Format[], allLines = false): Element =>
  (b) =>
    b.bestFitting(variants, allLines);
/** Ruff's `best_fit_parenthesize`: `contents` flat, else between `open` and `close` on lines of its own, else bare. */
export function bestFitParenthesize(
  open0: Format,
  contents: Format,
  close0: Format,
): Group {
  const g = ((b: Buffer) =>
    b.bestFitParenthesize(g, open0, contents, close0)) as Group;
  g.k = -1;
  return g;
}
/** Ruff's `fits_expanded`: while `whenFlat` (else always) prints flat, a measure counts only the text around it. */
export const fitsExpanded =
  (contents: Format, whenFlat?: GroupRef): Element =>
  (b) =>
    b.fitsExpanded(contents, whenFlat);
/** `broken` when `of` (by default the enclosing group) prints broken, else `flat`. */
export const ifBreak =
  (broken: Format, flat: Format = [], of?: GroupRef): Element =>
  (b) =>
    b.ifBreak(broken, flat, of);
/** Ruff's `indent_if_group_breaks`: `contents` indented when `of` prints broken. */
export const indentIfBreak =
  (contents: Format, of: GroupRef): Element =>
  (b) =>
    b.indentIfBreak(contents, of);
/** Ruff's `conditional_group`: a group while `cond` prints broken, else its contents in the mode around. */
export const groupIfBreak =
  (contents: Format, cond: GroupRef): Element =>
  (b) =>
    b.groupIfBreak(contents, cond);

/** Reads whether a part holds a forced break: a hard line, a break parent, or a group built broken. */
class Probe implements Buffer {
  breaks = false;
  token() {}
  literal() {}
  text() {}
  line(flags: number) {
    if (flags & HARD) this.breaks = true;
  }
  breakParent() {
    this.breaks = true;
  }
  group(_: GroupRef, contents: Format, shouldBreak: boolean) {
    if (shouldBreak) this.breaks = true;
    else put(this, contents);
  }
  indent(contents: Format) {
    put(this, contents);
  }
  lineSuffix(contents: Format) {
    put(this, contents);
  }
  // A measure breaks it by its last variant.
  bestFitting(variants: readonly Format[]) {
    put(this, variants.at(-1) ?? []);
  }
  bestFitParenthesize(_: GroupRef, _o: Format, contents: Format) {
    put(this, contents);
  }
  fitsExpanded(contents: Format) {
    put(this, contents);
  }
  ifBreak(broken: Format, flat: Format) {
    put(this, broken);
    put(this, flat);
  }
  indentIfBreak(contents: Format) {
    put(this, contents);
  }
  groupIfBreak(contents: Format) {
    put(this, contents);
  }
}

/** Ruff's `will_break`: whether `d` holds a forced break. */
export function willBreak(d: Format): boolean {
  const probe = new Probe();
  put(probe, d);
  return probe.breaks;
}

/**
 * Ruff's `RemoveSoftLinesBuffer`, into `inner`: `d` as it prints when nothing in it may break. Soft lines vanish
 * or become spaces, groups, indents and parentheses give their contents, a conditional its flat branch, a
 * best-fitting its first variant; hard lines, tokens and line suffixes pass through as they are.
 */
class RemoveSoftLines implements Buffer {
  constructor(readonly inner: Buffer) {}
  token(node: number, s: string, synthetic: boolean) {
    this.inner.token(node, s, synthetic);
  }
  literal(node: number, s: string) {
    this.inner.literal(node, s);
  }
  text(s: string) {
    this.inner.text(s);
  }
  line(flags: number) {
    if (flags & HARD) this.inner.line(flags);
    else if (!(flags & SOFT)) this.inner.text(" ");
  }
  breakParent() {
    this.inner.breakParent();
  }
  group(_: GroupRef, contents: Format) {
    put(this, contents);
  }
  indent(contents: Format) {
    put(this, contents);
  }
  lineSuffix(contents: Format, reserved: number) {
    this.inner.lineSuffix(contents, reserved);
  }
  bestFitting(variants: readonly Format[]) {
    put(this, variants[0] ?? []);
  }
  bestFitParenthesize(_: GroupRef, _o: Format, contents: Format) {
    put(this, contents);
  }
  fitsExpanded(contents: Format) {
    put(this, contents);
  }
  ifBreak(_: Format, flat: Format) {
    put(this, flat);
  }
  indentIfBreak(contents: Format) {
    put(this, contents);
  }
  groupIfBreak(contents: Format) {
    put(this, contents);
  }
}

export const removeSoftLines =
  (d: Format): Element =>
  (b) =>
    put(new RemoveSoftLines(b), d);
