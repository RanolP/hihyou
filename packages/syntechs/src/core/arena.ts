// The visible syntax tree as one growable Uint32Array of records written in postorder, read through methods
// that take a node handle: the record's word offset. Layout, measurements and the migration plan:
// docs/research/tree-arena.md.
//
// A leaf is  [head, start, end, parent, ord]
// an inner   [head, start, end, parent, ord, count, c1..cn]
// head = kind (bits 0-15) | field (16-23) | NAMED 24 | MISSING 25 | INNER 26 | FIXED 27 | lf (28-29).
// Bits 30 and 31 stay clear in every word, so a value read out is a small integer in V8 with or without
// pointer compression and never boxes when it lands in a Map key or an object field.

import { type Language, symbolName } from "./language.js";
import { LABEL_TOKEN, labelModes, labelText } from "./label.js";

/** Head flag: the node is named. Pass to `TreeBuilder.leaf` / `inner`. */
export const NAMED = 1 << 24;
/** Head flag: a zero-width token the parser inserted to recover from an error. */
export const MISSING = 1 << 25;
const INNER = 1 << 26;
/** Head flag: a token whose text is its kind's name, so `text` needs no slice of the source. */
export const FIXED = 1 << 27;
const LF_SHIFT = 28;
const LF_MAX = 3;
const FIELD_SHIFT = 16;

const START = 1;
const END = 2;
const PARENT = 3;
const ORD = 4;
const COUNT = 5;
const CHILDREN = 6;
const LEAF_WORDS = 5;

/** `parent` of the root. */
export const NO_NODE = -1;

/**
 * Record words per UTF-16 unit of source, just above the largest ratio among the bench inputs
 * (`research/tree-arena/arena.mjs` prints them): json 1.14, css 0.81-1.94, javascript 0.73-1.55,
 * typescript 1.05-1.23, tsx 1.38-1.42, python 0.89-1.17. Comment-heavy files overshoot by up to 2x; that
 * costs untouched zeroed memory, where undershooting costs a copy.
 */
const WORDS_PER_CHAR: Record<string, number> = {
  json: 1.2,
  css: 2.0,
  javascript: 1.6,
  typescript: 1.3,
  tsx: 1.5,
  python: 1.2,
};
const MIN_WORDS = 256;
/** Measured record words per node are 6.2-6.4, so ords sized at words/6 rarely doubles. */
const WORDS_PER_NODE = 6;

/**
 * Appends records in postorder: every child before its parent, leaves in source order. `leaf` and `inner`
 * push the new node onto a stack of finished siblings; `inner` takes the ones pushed since its `mark()` as its
 * children and patches their parent word. A node's `lf` comes from the source gap before its first leaf.
 */
export class TreeBuilder {
  private data: Uint32Array;
  private top = 0;
  private ords: Uint32Array;
  private count = 0;
  private readonly kids: number[] = [];
  private lastEnd = 0;

  constructor(
    private readonly lang: Language,
    private readonly source: string,
  ) {
    const words = Math.max(
      MIN_WORDS,
      Math.ceil(source.length * (WORDS_PER_CHAR[lang.name] ?? 1)),
    );
    this.data = new Uint32Array(words);
    this.ords = new Uint32Array(Math.ceil(words / WORDS_PER_NODE));
  }

  /** The sibling-stack depth to pass to `inner` once this node's children have been appended. */
  mark(): number {
    return this.kids.length;
  }

  /** `kind` is a public symbol id (aliases resolved); `flags` is any of `NAMED | MISSING | FIXED`. */
  leaf(
    kind: number,
    field: number,
    flags: number,
    start: number,
    end: number,
  ): void {
    const lf = lineBreaks(this.source, this.lastEnd, start);
    this.lastEnd = end;
    const head = kind | (field << FIELD_SHIFT) | flags | (lf << LF_SHIFT);
    this.grow(LEAF_WORDS);
    const h = this.top;
    const data = this.data;
    data[h] = head;
    data[h + START] = start;
    data[h + END] = end;
    data[h + ORD] = this.count;
    this.top = h + LEAF_WORDS;
    this.close(h);
  }

  /**
   * An inner node over the siblings appended since `mark`. With none it is a leaf: a parser node whose
   * children are all hidden and childless reads as one token, as the walk makes it.
   */
  inner(
    kind: number,
    field: number,
    flags: number,
    start: number,
    end: number,
    mark: number,
  ): void {
    const kids = this.kids;
    const n = kids.length - mark;
    if (n === 0) {
      this.leaf(kind, field, flags, start, end);
      return;
    }
    this.grow(CHILDREN + n);
    const h = this.top;
    const data = this.data;
    const first = kids[mark] as number;
    data[h] =
      kind |
      (field << FIELD_SHIFT) |
      (flags & ~FIXED) |
      INNER |
      ((data[first] as number) & (LF_MAX << LF_SHIFT));
    data[h + START] = start;
    data[h + END] = end;
    data[h + ORD] = this.count;
    data[h + COUNT] = n;
    for (let i = 0; i < n; i++) {
      const c = kids[mark + i] as number;
      data[h + CHILDREN + i] = c;
      data[c + PARENT] = h;
    }
    kids.length = mark;
    this.top = h + CHILDREN + n;
    this.close(h);
  }

  // ---- for DirectTree (tree.ts), which appends nodes before it knows their parent's alias and field -------

  /** @internal The `i`th unparented node, `0 <= i < mark()`. */
  kid(i: number): number {
    return this.kids[i] as number;
  }

  /** @internal Whether finished node `h` has children. */
  isInner(h: number): boolean {
    return ((this.data[h] as number) & INNER) !== 0;
  }

  /** @internal */
  fieldOf(h: number): number {
    return ((this.data[h] as number) >>> FIELD_SHIFT) & 0xff;
  }

  /** @internal */
  setField(h: number, field: number): void {
    const data = this.data;
    data[h] =
      ((data[h] as number) & ~(0xff << FIELD_SHIFT)) | (field << FIELD_SHIFT);
  }

  /** @internal Gives finished node `h` a new kind, field and `NAMED | FIXED` flags; `lf` and the rest stay. */
  retag(h: number, kind: number, field: number, flags: number): void {
    const data = this.data;
    data[h] =
      ((data[h] as number) & (INNER | MISSING | (LF_MAX << LF_SHIFT))) |
      kind |
      (field << FIELD_SHIFT) |
      flags;
  }

  /** @internal */
  startOf(h: number): number {
    return this.data[h + START] as number;
  }

  /** @internal */
  endOf(h: number): number {
    return this.data[h + END] as number;
  }

  /** @internal Takes the unparented nodes from `from` on off the stack, to `attach` back later in order. */
  detach(from: number): number[] {
    return this.kids.splice(from);
  }

  /** @internal */
  attach(h: number): void {
    this.kids.push(h);
  }

  /**
   * @internal Undoes the last `inner`, putting its children back on the stack. False, with nothing changed,
   * when the last node appended is not an unparented inner node.
   */
  unwrapLast(): boolean {
    const kids = this.kids;
    const h = kids[kids.length - 1];
    if (
      h === undefined ||
      this.count === 0 ||
      this.ords[this.count - 1] !== h ||
      ((this.data[h] as number) & INNER) === 0
    )
      return false;
    const data = this.data;
    kids.pop();
    const n = data[h + COUNT] as number;
    for (let i = 0; i < n; i++) kids.push(data[h + CHILDREN + i] as number);
    this.count--;
    this.top = h;
    return true;
  }

  /** The tree, rooted at the one node left unparented; the builder must not be used afterwards. */
  finish(errorChars: number): Tree {
    if (this.kids.length !== 1)
      throw new RangeError(
        `a tree needs exactly one root, the builder holds ${this.kids.length}`,
      );
    const root = this.kids[0] as number;
    this.data[root + PARENT] = root;
    const source = this.source;
    const trailingLf = lineBreaks(source, this.lastEnd, source.length);
    return new Tree(
      this.data,
      this.ords,
      this.count,
      root,
      errorChars,
      trailingLf,
      this.lang,
      source,
    );
  }

  private close(h: number): void {
    if (this.count === this.ords.length) {
      const next = new Uint32Array(this.ords.length * 2);
      next.set(this.ords);
      this.ords = next;
    }
    this.ords[this.count++] = h;
    this.kids.push(h);
  }

  private grow(words: number): void {
    const need = this.top + words;
    if (need <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < need) size *= 2;
    const next = new Uint32Array(size);
    next.set(this.data);
    this.data = next;
  }
}

/** Line breaks in `source` from `from` up to `to`, clamped to `LF_MAX`. */
function lineBreaks(source: string, from: number, to: number): number {
  let lf = 0;
  for (let i = from; i < to && lf < LF_MAX; i++) {
    const c = source.charCodeAt(i);
    // A CRLF counts once; a CR whose LF opens the token still ends a line in the gap.
    if (
      c === 10 ||
      (c === 13 && (i + 1 === to || source.charCodeAt(i + 1) !== 10))
    )
      lf++;
  }
  return lf;
}

/** Whether the source span is exactly the name of public symbol `kind`, checked against the source. */
export function isFixed(
  lang: Language,
  kind: number,
  source: string,
  start: number,
  end: number,
): boolean {
  const name = symbolName(lang, kind);
  return end - start === name.length && source.startsWith(name, start);
}

/**
 * A parsed file's visible nodes. A node is a number, so it serves as a Map key or a Set member. Offsets are
 * UTF-16 code units into the source.
 */
export class Tree {
  /** @internal Built by `TreeBuilder.finish`. */
  constructor(
    private readonly data: Uint32Array,
    private readonly ords: Uint32Array,
    /** Number of nodes; ordinals run `0 .. nodeCount - 1`. */
    readonly nodeCount: number,
    readonly root: number,
    /** Characters covered by ERROR nodes, for the caller's parse-error threshold. */
    readonly errorChars: number,
    /** Newlines after the last leaf to the end of the source, clamped to 3: `lf` of the end of file. */
    readonly trailingLf: number,
    private readonly lang: Language,
    private readonly source: string,
  ) {}

  /** The source starts with a byte order mark, which the lexer skips as padding before the root. */
  get bom(): boolean {
    return this.source.charCodeAt(0) === 0xfeff;
  }

  /** Public symbol id, aliases resolved. */
  kind(n: number): number {
    return (this.data[n] as number) & 0xffff;
  }

  kindName(n: number): string {
    return symbolName(this.lang, this.kind(n));
  }

  /** False for anonymous tokens the grammar spells literally (punctuation, keywords). */
  named(n: number): boolean {
    return ((this.data[n] as number) & NAMED) !== 0;
  }

  missing(n: number): boolean {
    return ((this.data[n] as number) & MISSING) !== 0;
  }

  /** Field id of the node's role in its parent, 0 for none. */
  field(n: number): number {
    return ((this.data[n] as number) >>> FIELD_SHIFT) & 0xff;
  }

  fieldName(n: number): string | undefined {
    const f = this.field(n);
    return f === 0 ? undefined : this.lang.fieldNames[f];
  }

  /** Newlines in the source before the node's first leaf, back to the previous leaf (a comment is a leaf), clamped to 3. */
  lf(n: number): number {
    return ((this.data[n] as number) >>> LF_SHIFT) & LF_MAX;
  }

  /** Number of children; 0 for a leaf. */
  count(n: number): number {
    const data = this.data;
    return ((data[n] as number) & INNER) === 0
      ? 0
      : (data[n + COUNT] as number);
  }

  /** The `i`th child, `0 <= i < count(n)`, in source order. */
  child(n: number, i: number): number {
    return this.data[n + CHILDREN + i] as number;
  }

  /** `NO_NODE` for the root. */
  parent(n: number): number {
    return n === this.root ? NO_NODE : (this.data[n + PARENT] as number);
  }

  start(n: number): number {
    return this.data[n + START] as number;
  }

  end(n: number): number {
    return this.data[n + END] as number;
  }

  /** Dense postorder ordinal: a subtree is the ordinal range `[ord(n) - size + 1, ord(n)]`. */
  ord(n: number): number {
    return this.data[n + ORD] as number;
  }

  /** The node with ordinal `ord`. */
  at(ord: number): number {
    if (ord < 0 || ord >= this.nodeCount)
      throw new RangeError(
        `no ordinal ${ord} in a tree of ${this.nodeCount} nodes`,
      );
    return this.ords[ord] as number;
  }

  /**
   * The source the node spans. For a leaf that is its token; for an inner node it includes text no child
   * covers, such as the number of a CSS `float_value` whose only child is its `unit`.
   */
  text(n: number): string {
    const head = this.data[n] as number;
    if ((head & FIXED) !== 0) return symbolName(this.lang, head & 0xffff);
    return this.source.slice(this.start(n), this.end(n));
  }

  /**
   * UTF-16 units from the start of `n`'s line to `n`'s start. Ruff compares a comment's indentation with the
   * statements around it to pick the block the comment closes, which no line-break count can tell.
   */
  col(n: number): number {
    const source = this.source;
    const start = this.start(n);
    let i = start;
    while (i > 0) {
      const c = source.charCodeAt(i - 1);
      if (c === 10 || c === 13) break;
      i--;
    }
    return start - i;
  }

  /** Whether `b` starts exactly where `a` ends: no whitespace, comment or other text between them. */
  adjoins(a: number, b: number): boolean {
    return this.end(a) === this.start(b);
  }

  /** The source's line ending as prettier's guessEndOfLine reads it: after the first `\r`, else `\n`. */
  lineEnding(): "\n" | "\r\n" | "\r" {
    const cr = this.source.indexOf("\r");
    return cr === -1
      ? "\n"
      : this.source.charAt(cr + 1) === "\n"
        ? "\r\n"
        : "\r";
  }

  /** A leaf's text with comment and JSX-text whitespace runs collapsed to one space; "" for an inner node. */
  label(n: number): string {
    const head = this.data[n] as number;
    if ((head & INNER) !== 0) return "";
    const kind = head & 0xffff;
    const modes = labelModes(this.lang);
    return labelText(
      kind < modes.length ? (modes[kind] as number) : LABEL_TOKEN,
      this.text(n),
    );
  }
}
