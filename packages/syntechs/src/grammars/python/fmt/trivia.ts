import { NO_NODE } from "../../../core/arena.js";
import { type FormatTree, firstLeaf } from "../../../fmt/tree.js";

/**
 * Ruff's `SimpleTokenizer` and line counting (ruff_python_trivia), read off the tree: the formatter asks what
 * lies between two nodes (a paren, a comma, how many blank lines) by walking only the leaves of that gap.
 *
 * A position stands where a source offset stood in ruff: leaf `l` starts at `2 * ord(l)` and ends at
 * `2 * ord(l) + 1`, and a node spans its first leaf's start to its last leaf's end. Leaves keep source order in
 * postorder, so positions order as offsets do; two positions are never equal across a gap, so adjacency is
 * `tree.adjoins`, never `a.end === b.start`. The gap before leaf `l` lies inside `[from, to)` when
 * `from < start(l) <= to`.
 */

export interface Tok {
  /** The token's text for punctuation and keywords; `name` for other words, numbers included. */
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly node: number;
}

/** The start of the whole file, before its first leaf. */
export const FILE_START = -1;
/** The end of the whole file, after its last leaf. */
export const FILE_END = Number.MAX_SAFE_INTEGER;

const KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
  "case",
  "match",
  "type",
]);

const isIdent = (c: string) => /[\p{L}\p{N}_]/u.test(c);

/** The last leaf of `n`: `n` itself when it is one. */
export function lastLeaf(tree: FormatTree, n: number): number {
  for (let c = tree.count(n); c > 0; c = tree.count(n)) n = tree.child(n, c - 1);
  return n;
}

export const startOf = (tree: FormatTree, n: number): number =>
  2 * tree.ord(firstLeaf(tree, n));
export const endOf = (tree: FormatTree, n: number): number =>
  2 * tree.ord(lastLeaf(tree, n)) + 1;

/** The leaf a position belongs to: the one it starts or ends. */
export const leafAt = (tree: FormatTree, pos: number): number =>
  tree.at(pos >> 1);

const isLeaf = (tree: FormatTree, n: number) => tree.count(n) === 0;

/** The first leaf starting at or after `pos`, or `NO_NODE`. */
export function leafFrom(tree: FormatTree, pos: number): number {
  for (let o = Math.max(0, Math.ceil(pos / 2)); o < tree.nodeCount; o++) {
    const l = tree.at(o);
    if (isLeaf(tree, l)) return l;
  }
  return NO_NODE;
}

/** The last leaf ending at or before `pos`, or `NO_NODE`. */
export function leafBefore(tree: FormatTree, pos: number): number {
  for (let o = Math.min(tree.nodeCount - 1, (pos - 1) >> 1); o >= 0; o--) {
    const l = tree.at(o);
    if (isLeaf(tree, l)) return l;
  }
  return NO_NODE;
}

export const nextLeafOf = (tree: FormatTree, l: number): number =>
  leafFrom(tree, 2 * tree.ord(l) + 1);
export const prevLeafOf = (tree: FormatTree, l: number): number =>
  leafBefore(tree, 2 * tree.ord(l));

/** A comment or a line continuation: what ruff's tokenizer skips as trivia. */
export function isTrivia(tree: FormatTree, l: number): boolean {
  const k = tree.kindName(l);
  return k === "comment" || k === "line_continuation";
}

const isComment = (tree: FormatTree, l: number) =>
  tree.kindName(l) === "comment";

/** Line breaks before leaf `l`, back to the previous leaf; at the end of the file, the trailing ones. */
const lfOf = (tree: FormatTree, l: number) =>
  l === NO_NODE ? tree.trailingLf : tree.lf(l);

function kindOf(text: string): string {
  if (KEYWORDS.has(text)) return text;
  return isIdent(text.charAt(0)) ? "name" : text;
}

/** The tokens in `[start, end)`, trivia skipped, lazily. */
export function* tokens(
  tree: FormatTree,
  start: number,
  end = FILE_END,
): Generator<Tok> {
  for (let o = Math.max(0, Math.ceil(start / 2)); o < tree.nodeCount; o++) {
    if (2 * o + 1 > end) return;
    const l = tree.at(o);
    if (!isLeaf(tree, l) || isTrivia(tree, l)) continue;
    yield { kind: kindOf(tree.text(l)), start: 2 * o, end: 2 * o + 1, node: l };
  }
}

/** The first non-trivia token at or after `start` and before `end`. */
export function firstToken(
  tree: FormatTree,
  start: number,
  end = FILE_END,
): Tok | undefined {
  for (const t of tokens(tree, start, end)) return t;
  return undefined;
}

/** Ruff's `find_only_token_in_range`: the one token between two nodes, after the closing parens of the left one. */
export function onlyToken(
  tree: FormatTree,
  start: number,
  end: number,
  kind: string,
): Tok {
  for (const t of tokens(tree, start, end)) {
    if (t.kind === ")") continue;
    if (t.kind !== kind)
      throw new Error(`expected ${kind} at ${t.start}, found ${t.kind}`);
    return t;
  }
  throw new Error(`no ${kind} in ${start}..${end}`);
}

/** Whether any token in `[start, end)` is `kind`. */
export function hasToken(
  tree: FormatTree,
  start: number,
  end: number,
  kind: string,
): boolean {
  for (const t of tokens(tree, start, end)) if (t.kind === kind) return true;
  return false;
}

const endsLine = (text: string) => /[\r\n]$/.test(text);

/** Line breaks between `pos` (a leaf's start) and the previous non-whitespace character. */
export function linesBefore(tree: FormatTree, pos: number): number {
  const l = leafFrom(tree, pos);
  const prev = leafBefore(tree, pos);
  // A line continuation's own line break is the last character before the next line.
  const cont = prev !== NO_NODE && endsLine(tree.text(prev)) ? 1 : 0;
  return lfOf(tree, l) + cont;
}

/** Line breaks between `pos` (a leaf's end) and the next non-whitespace character. */
export function linesAfter(tree: FormatTree, pos: number): number {
  return lfOf(tree, leafFrom(tree, pos));
}

/** Line breaks after `pos` up to the next code token, counting only those after the last comment. */
export function linesAfterIgnoringTrivia(
  tree: FormatTree,
  pos: number,
): number {
  let n = 0;
  for (let l = leafFrom(tree, pos); ; l = nextLeafOf(tree, l)) {
    n += lfOf(tree, l);
    if (l === NO_NODE || !isComment(tree, l)) return n;
    n = 0;
  }
}

/** Line breaks after `pos`, past the end-of-line trivia, up to the next non-blank line. */
export function linesAfterIgnoringEndOfLineTrivia(
  tree: FormatTree,
  pos: number,
): number {
  let l = leafFrom(tree, pos);
  while (l !== NO_NODE && tree.lf(l) === 0 && isTrivia(tree, l))
    l = nextLeafOf(tree, l);
  return lfOf(tree, l);
}

/** The empty lines in `[start, end)` (from ruff's placement): the most between two comments. */
export function maxEmptyLines(
  tree: FormatTree,
  start: number,
  end: number,
): number {
  let max = 0;
  for (let l = leafFrom(tree, start); ; l = nextLeafOf(tree, l)) {
    max = Math.max(max, lfOf(tree, l));
    if (l === NO_NODE || 2 * tree.ord(l) >= end || !isComment(tree, l)) break;
  }
  return Math.max(0, max - 1);
}

/** Whether `[start, end)` holds a line break, in a gap or inside a token. */
export function hasLineBreak(
  tree: FormatTree,
  start: number,
  end: number,
): boolean {
  let o = Math.max(0, start >> 1);
  for (; o < tree.nodeCount && 2 * o <= end; o++) {
    const l = tree.at(o);
    if (!isLeaf(tree, l)) continue;
    if (start < 2 * o && tree.lf(l) > 0) return true;
    if (start <= 2 * o && 2 * o + 1 <= end && /[\r\n]/.test(tree.text(l)))
      return true;
  }
  return o >= tree.nodeCount && end === FILE_END && tree.trailingLf > 0;
}

/** Whether leaf `l` is the first thing on its line. */
export function startsLine(tree: FormatTree, l: number): boolean {
  if (tree.lf(l) > 0) return true;
  const prev = prevLeafOf(tree, l);
  return prev === NO_NODE || endsLine(tree.text(prev));
}

/** The indentation of the line `pos` (a leaf's start) begins, or undefined if code precedes it there. */
export function indentationAt(
  tree: FormatTree,
  pos: number,
): number | undefined {
  const l = leafFrom(tree, pos);
  return startsLine(tree, l) ? tree.col(l) : undefined;
}

/** The last code token's last character before `pos`, comments and line continuations skipped. */
export function previousChar(
  tree: FormatTree,
  pos: number,
): string | undefined {
  for (let l = leafBefore(tree, pos); l !== NO_NODE; l = prevLeafOf(tree, l))
    if (!isTrivia(tree, l)) return tree.text(l).at(-1);
  return undefined;
}
