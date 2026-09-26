// The visible syntax tree as one growable Uint32Array of records written in postorder, read through methods
// that take a node handle: the record's word offset. Layout, measurements and the migration plan:
// docs/research/tree-arena.md.
//
// A leaf is  [head, start, end, parent, ord]
// an inner   [head, start, end, parent, ord, count, c1..cn]
// head = kind (bits 0-15) | field (16-23) | NAMED 24 | MISSING 25 | INNER 26 | FIXED 27 | lf (28-29).
// Bits 30 and 31 stay clear in every word, so a value read out is a small integer in V8 with or without
// pointer compression and never boxes when it lands in a Map key or an object field.

import {
  FLAG_NAMED,
  type Language,
  publicSymbol,
  SYM_ERROR,
  symbolFlags,
  symbolName,
} from "./language.js";
import { jsxText, type SyntaxNode, type SyntaxTree } from "./tree.js";

/** Head flag: the node is named. Pass to `TreeBuilder.leaf` / `inner`. */
export const NAMED = 1 << 24;
/** Head flag: a zero-width token the parser inserted to recover from an error. */
export const MISSING = 1 << 25;
const INNER = 1 << 26;
/** A token whose text is its kind's name, so `text` needs no slice of the source. */
const FIXED = 1 << 27;
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

const LABEL_TOKEN = 0;
const LABEL_COMMENT = 1;
const LABEL_JSX_TEXT = 2;

/** How each public kind's `label` is derived, per language; kinds past the end (ERROR) are plain tokens. */
const labelModes = new WeakMap<Language, Uint8Array>();

function labelModesOf(lang: Language): Uint8Array {
  let modes = labelModes.get(lang);
  if (modes) return modes;
  modes = new Uint8Array(lang.symbolNames.length);
  for (let kind = 0; kind < modes.length; kind++) {
    const name = lang.symbolNames[kind] as string;
    modes[kind] = name.includes("comment")
      ? LABEL_COMMENT
      : name === "jsx_text"
        ? LABEL_JSX_TEXT
        : LABEL_TOKEN;
  }
  labelModes.set(lang, modes);
  return modes;
}

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

  /** `kind` is a public symbol id (aliases resolved); `flags` is `NAMED | MISSING` or 0. */
  leaf(
    kind: number,
    field: number,
    flags: number,
    start: number,
    end: number,
  ): void {
    const source = this.source;
    let lf = 0;
    for (let i = this.lastEnd; i < start && lf < LF_MAX; i++) {
      const c = source.charCodeAt(i);
      // A CRLF counts once; a CR whose LF opens the token still ends a line in the gap.
      if (
        c === 10 ||
        (c === 13 && (i + 1 === start || source.charCodeAt(i + 1) !== 10))
      )
        lf++;
    }
    this.lastEnd = end;
    let head = kind | (field << FIELD_SHIFT) | flags | (lf << LF_SHIFT);
    if ((flags & (NAMED | MISSING)) === 0) {
      const name = symbolName(this.lang, kind);
      if (end - start === name.length && source.startsWith(name, start))
        head |= FIXED;
    }
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
   * children are all hidden and childless reads as one token, as `walkTree` makes it.
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
      flags |
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

  /** The tree, rooted at the one node left unparented; the builder must not be used afterwards. */
  finish(errorChars: number): Tree {
    if (this.kids.length !== 1)
      throw new RangeError(
        `a tree needs exactly one root, the builder holds ${this.kids.length}`,
      );
    const root = this.kids[0] as number;
    this.data[root + PARENT] = root;
    return new Tree(
      this.data,
      this.ords,
      this.count,
      root,
      errorChars,
      this.lang,
      this.source,
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

/**
 * A parsed file's visible nodes. A node is a number, so it serves as a Map key or a Set member the way a
 * SyntaxNode object did. Offsets are UTF-16 code units into the source.
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
    private readonly lang: Language,
    private readonly source: string,
  ) {}

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

  /** A leaf's text with comment and JSX-text whitespace runs collapsed to one space; "" for an inner node. */
  label(n: number): string {
    const head = this.data[n] as number;
    if ((head & INNER) !== 0) return "";
    const kind = head & 0xffff;
    const modes = labelModesOf(this.lang);
    const mode = kind < modes.length ? modes[kind] : LABEL_TOKEN;
    const token = this.text(n);
    if (mode === LABEL_COMMENT) return token.replace(/\s+/g, " ");
    if (mode === LABEL_JSX_TEXT) return jsxText(token);
    return token;
  }
}

/** Public symbol id by `named` flag and kind name, per language: a SyntaxNode carries only the name. */
const kindIds = new WeakMap<Language, Map<string, number>>();

function kindIdsOf(lang: Language): Map<string, number> {
  let ids = kindIds.get(lang);
  if (ids) return ids;
  ids = new Map([["1ERROR", SYM_ERROR]]);
  for (let s = 0; s < lang.symbolNames.length; s++) {
    const kind = publicSymbol(lang, s);
    const key = `${symbolFlags(lang, s) & FLAG_NAMED ? 1 : 0}${symbolName(lang, kind)}`;
    if (!ids.has(key)) ids.set(key, kind);
  }
  kindIds.set(lang, ids);
  return ids;
}

/** The arena form of a SyntaxTree parsed from `source`, until the parser builds one directly. */
export function fromSyntaxTree(
  lang: Language,
  tree: SyntaxTree,
  source: string,
): Tree {
  const kinds = kindIdsOf(lang);
  const fields = new Map(lang.fieldNames.map((name, id) => [name, id]));
  const b = new TreeBuilder(lang, source);
  const add = (n: SyntaxNode, mark: number) => {
    const kind = kinds.get(`${n.named ? 1 : 0}${n.kind}`);
    if (kind === undefined)
      throw new RangeError(`no ${lang.name} symbol for node kind ${n.kind}`);
    const field = n.field === undefined ? 0 : (fields.get(n.field) as number);
    const flags = (n.named ? NAMED : 0) | (n.missing ? MISSING : 0);
    if (n.children.length === 0) b.leaf(kind, field, flags, n.start, n.end);
    else b.inner(kind, field, flags, n.start, n.end, mark);
  };
  const root = tree.nodes[0];
  if (!root) throw new RangeError("a SyntaxTree with no nodes");
  // Postorder without recursion: the open nodes, the next child of each, and the sibling mark it started at.
  const open: SyntaxNode[] = [root];
  const next: number[] = [0];
  const marks: number[] = [b.mark()];
  while (open.length > 0) {
    const d = open.length - 1;
    const n = open[d] as SyntaxNode;
    const i = next[d] as number;
    if (i < n.children.length) {
      next[d] = i + 1;
      const c = n.children[i] as SyntaxNode;
      if (c.children.length === 0) add(c, 0);
      else {
        open.push(c);
        next.push(0);
        marks.push(b.mark());
      }
      continue;
    }
    open.pop();
    next.pop();
    add(n, marks.pop() as number);
  }
  return b.finish(tree.errorChars);
}
