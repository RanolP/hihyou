/**
 * Ruff's `SimpleTokenizer` and line counting (ruff_python_trivia): the formatter asks what lies between two
 * nodes (a paren, a comma, how many blank lines) by lexing only that gap, never the whole file.
 */

export interface Tok {
  /** The token's text for punctuation and keywords; `name`, `ws`, `nl`, `comment`, `cont` or `other` else. */
  readonly kind: string;
  readonly start: number;
  readonly end: number;
}

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

const PUNCT3 = ["**=", "//=", ">>=", "<<=", "..."];
const PUNCT2 = [
  ":=",
  "->",
  "**",
  "//",
  "<<",
  ">>",
  "<=",
  ">=",
  "==",
  "!=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "@=",
];

const isWs = (c: string) => c === " " || c === "\t" || c === "\f";
const isIdent = (c: string) => /[\p{L}\p{N}_]/u.test(c);

/** The token of `src` at `pos` (not past `end`). */
export function lexAt(src: string, pos: number, end = src.length): Tok {
  const c = src[pos] as string;
  if (isWs(c)) {
    let e = pos + 1;
    while (e < end && isWs(src[e] as string)) e++;
    return { kind: "ws", start: pos, end: e };
  }
  if (c === "\n") return { kind: "nl", start: pos, end: pos + 1 };
  if (c === "\r")
    return {
      kind: "nl",
      start: pos,
      end: src[pos + 1] === "\n" && pos + 1 < end ? pos + 2 : pos + 1,
    };
  if (c === "#") {
    let e = pos + 1;
    while (e < end && src[e] !== "\n" && src[e] !== "\r") e++;
    return { kind: "comment", start: pos, end: e };
  }
  if (c === "\\") {
    let e = pos + 1;
    if (src[e] === "\r") e++;
    if (src[e] === "\n") e++;
    return { kind: "cont", start: pos, end: Math.min(e, end) };
  }
  if (isIdent(c)) {
    let e = pos + 1;
    while (e < end && isIdent(src[e] as string)) e++;
    const word = src.slice(pos, e);
    return { kind: KEYWORDS.has(word) ? word : "name", start: pos, end: e };
  }
  for (const p of PUNCT3)
    if (src.startsWith(p, pos) && pos + 3 <= end)
      return { kind: p, start: pos, end: pos + 3 };
  for (const p of PUNCT2)
    if (src.startsWith(p, pos) && pos + 2 <= end)
      return { kind: p, start: pos, end: pos + 2 };
  return { kind: c, start: pos, end: pos + 1 };
}

export const isTrivia = (t: Tok) =>
  t.kind === "ws" ||
  t.kind === "nl" ||
  t.kind === "comment" ||
  t.kind === "cont";

/** The tokens of `src[start, end)`, trivia skipped, lazily. */
export function* tokens(
  src: string,
  start: number,
  end = src.length,
): Generator<Tok> {
  let pos = start;
  while (pos < end) {
    const t = lexAt(src, pos, end);
    pos = t.end;
    if (!isTrivia(t)) yield t;
  }
}

/** The first non-trivia token at or after `start` and before `end`. */
export function firstToken(
  src: string,
  start: number,
  end = src.length,
): Tok | undefined {
  for (const t of tokens(src, start, end)) return t;
  return undefined;
}

/** Ruff's `find_only_token_in_range`: the one token between two nodes, after the closing parens of the left one. */
export function onlyToken(
  src: string,
  start: number,
  end: number,
  kind: string,
): Tok {
  for (const t of tokens(src, start, end)) {
    if (t.kind === ")") continue;
    if (t.kind !== kind)
      throw new Error(`expected ${kind} at ${t.start}, found ${t.kind}`);
    return t;
  }
  throw new Error(`no ${kind} in ${start}..${end}`);
}

/** Whether any token in `src[start, end)` is `kind`. */
export function hasToken(
  src: string,
  start: number,
  end: number,
  kind: string,
): boolean {
  for (const t of tokens(src, start, end)) if (t.kind === kind) return true;
  return false;
}

const isPyWs = (c: string | undefined) => c === " " || c === "\t" || c === "\f";

/** Line breaks between `offset` and the previous non-whitespace character. */
export function linesBefore(offset: number, src: string): number {
  let n = 0;
  let i = offset - 1;
  while (i >= 0) {
    const c = src[i];
    if (c === "\n") {
      n++;
      if (src[i - 1] === "\r") i--;
    } else if (c === "\r") n++;
    else if (!isPyWs(c)) break;
    i--;
  }
  return n;
}

/** Line breaks between `offset` and the next non-whitespace character. */
export function linesAfter(offset: number, src: string): number {
  let n = 0;
  let i = offset;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") n++;
    else if (c === "\r") {
      n++;
      if (src[i + 1] === "\n") i++;
    } else if (!isPyWs(c)) break;
    i++;
  }
  return n;
}

/** Line breaks after `offset` up to the next code token, counting only those after the last comment. */
export function linesAfterIgnoringTrivia(offset: number, src: string): number {
  let n = 0;
  let pos = offset;
  while (pos < src.length) {
    const t = lexAt(src, pos);
    pos = t.end;
    if (t.kind === "nl") n++;
    else if (t.kind === "ws") continue;
    else if (t.kind === "comment") n = 0;
    else break;
  }
  return n;
}

/** Line breaks after `offset`, past the end-of-line trivia, up to the next non-blank line. */
export function linesAfterIgnoringEndOfLineTrivia(
  offset: number,
  src: string,
): number {
  let pos = offset;
  let n = 0;
  let started = false;
  while (pos < src.length) {
    const t = lexAt(src, pos);
    pos = t.end;
    if (!started) {
      if (t.kind !== "nl" && isTrivia(t)) continue;
      started = true;
    }
    if (t.kind === "nl") n++;
    else if (t.kind !== "ws") break;
  }
  return n;
}

/** The empty lines in `src[start, end)` (from ruff's placement): the most between two comments. */
export function maxEmptyLines(src: string, start: number, end: number): number {
  let newlines = 0;
  let max = 0;
  let pos = start;
  while (pos < end) {
    const t = lexAt(src, pos, end);
    pos = t.end;
    if (t.kind === "nl") newlines++;
    else if (t.kind === "ws") continue;
    else if (t.kind === "comment") {
      max = Math.max(max, newlines);
      newlines = 0;
    } else {
      max = Math.max(max, newlines);
      newlines = 0;
      break;
    }
  }
  return Math.max(0, Math.max(max, newlines) - 1);
}

/** The start of the line holding `offset`. */
export function lineStart(src: string, offset: number): number {
  let i = offset;
  while (i > 0 && src[i - 1] !== "\n" && src[i - 1] !== "\r") i--;
  return i;
}

/** The end of the line holding `offset`, after its line break. */
export function fullLineEnd(src: string, offset: number): number {
  let i = offset;
  while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
  if (src[i] === "\r") i++;
  if (src[i] === "\n" && src[i - 1] !== "\n") i++;
  return i;
}

/** The whitespace before `offset` on its line, or undefined if code precedes it there. */
export function indentationAt(src: string, offset: number): string | undefined {
  const s = lineStart(src, offset);
  for (let i = s; i < offset; i++) if (!isPyWs(src[i])) return undefined;
  return src.slice(s, offset);
}

/** Whether `src[start, end)` holds a line break. */
export function hasLineBreak(src: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++)
    if (src[i] === "\n" || src[i] === "\r") return true;
  return false;
}
