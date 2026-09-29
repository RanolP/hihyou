import { NO_NODE } from "../../../../core/arena.js";
import { closeDead, openDead } from "../../../../fmt/stream.js";
import type { FormatTree } from "../../../../fmt/tree.js";
import type { Py, Stmt } from "../ast.js";
import type { Fmt } from "../builders.js";
import type { Comment } from "../comments.js";
import { lastChildInBody } from "../comments.js";
import { BLANK, COLLAPSE, HARD, sLine, sLiteral } from "../sink.js";
import { firstToken, leafAt, leafBefore, leafFrom, prevLeafOf, type Tok, tokens } from "../trivia.js";

/**
 * Ruff's suppression comments (verbatim.rs, comments/format.rs `SuppressionKind`): an own-line `# fmt: off` (or
 * `# yapf: disable`) keeps the statements after it as written up to an own-line `# fmt: on` (`# yapf: enable`)
 * at the same level, and an end-of-line `# fmt: skip` (or `# fmt: off`) keeps its statement or clause as written.
 */

export type Suppression = "off" | "on" | "skip";

/** Ruff's `SuppressionKind::from_comment`. */
export function suppressionOf(text: string): Suppression | undefined {
  const trimmed = text.replace(/^#/, "").trim();
  const fmt = /^fmt:\s*(.*)$/.exec(trimmed);
  if (fmt) {
    if (fmt[1] === "off" || fmt[1] === "on" || fmt[1] === "skip") return fmt[1];
  } else {
    const yapf = /^yapf:\s*(.*)$/.exec(trimmed);
    if (yapf?.[1] === "disable") return "off";
    if (yapf?.[1] === "enable") return "on";
  }
  // A skip can share its comment with others: `# fmt: skip # noqa`.
  for (const segment of text.split("#"))
    if (/^fmt:\s*skip$/.test(segment.trim())) return "skip";
  return undefined;
}

const kindOf = (f: Fmt, c: Comment) => suppressionOf(f.text(c.ts));
export const isOff = (f: Fmt, c: Comment): boolean => c.line === "own" && kindOf(f, c) === "off";
export const isOn = (f: Fmt, c: Comment): boolean => c.line === "own" && kindOf(f, c) === "on";

/** Ruff's `SuppressionKind::has_skip_comment`: an end-of-line `fmt: skip` or `fmt: off` among `cs`. */
export function hasSkip(f: Fmt, cs: readonly Comment[]): boolean {
  return cs.some((c) => {
    if (c.line !== "eol") return false;
    const k = kindOf(f, c);
    return k === "skip" || k === "off";
  });
}

// ---- the source text ----

/** The file's text, and where each leaf starts in it (by ordinal; -1 for inner nodes). */
interface Source {
  readonly text: string;
  readonly starts: Int32Array;
}

const sources = new WeakMap<FormatTree, Source>();

/**
 * What a suppression keeps is the source text itself, which the tree gives only as the root's text; each leaf is
 * found in it in order, as only whitespace (and text no leaf covers) lies between two leaves.
 */
function sourceOf(tree: FormatTree): Source {
  let s = sources.get(tree);
  if (s) return s;
  const text = tree.text(tree.root);
  const starts = new Int32Array(tree.nodeCount).fill(-1);
  let at = 0;
  for (let o = 0; o < tree.nodeCount; o++) {
    const l = tree.at(o);
    if (tree.count(l) > 0) continue;
    const t = tree.text(l);
    if (t.length > 0) {
      const i = text.indexOf(t, at);
      if (i >= 0) at = i;
    }
    starts[o] = at;
    at += t.length;
  }
  s = { text, starts };
  sources.set(tree, s);
  return s;
}

/** The source offset of position `pos`: a leaf's start (even) or end (odd). */
function offsetOf(tree: FormatTree, pos: number): number {
  const src = sourceOf(tree);
  const o = pos >> 1;
  const start = src.starts[o] ?? 0;
  return pos & 1 ? start + tree.text(tree.at(o)).length : start;
}

const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, "\n");
const isWhitespace = (c: string) => c === " " || c === "\t" || c === "\f";

/** Ruff's `verbatim_text`: the source from position `start` to `end`, its line breaks as written. */
export function writeVerbatimText(f: Fmt, start: number, end: number): void {
  const text = sourceOf(f.tree).text.slice(offsetOf(f.tree, start), offsetOf(f.tree, end));
  sLiteral(leafAt(f.tree, start), normalizeNewlines(text));
}

/** Ruff's `Indentation::from_stmt`: the whitespace characters that start the line `s` starts on. */
function indentationOf(f: Fmt, s: Py): number {
  const text = sourceOf(f.tree).text;
  let lineStart = offsetOf(f.tree, s.start);
  while (lineStart > 0 && text[lineStart - 1] !== "\n" && text[lineStart - 1] !== "\r") lineStart--;
  let n = 0;
  while (isWhitespace(text[lineStart + n] ?? "")) n++;
  return n;
}

/**
 * Ruff's `FormatVerbatimStatementRange`: the source from offset `from` to `to` line by logical line, each without
 * the first `indentation` whitespace characters (the formatter indents it), a line break or blank line after each.
 */
function writeVerbatimRange(f: Fmt, from: number, to: number, indentation: number): void {
  const tree = f.tree;
  const src = sourceOf(tree);
  const text = src.text;
  // The line breaks that end a logical line: those outside brackets, between leaves.
  const ends: [number, number][] = [];
  const breaksIn = (a: number, b: number) => {
    const re = /\r\n|\r|\n/g;
    const gap = text.slice(a, b);
    for (let m = re.exec(gap); m; m = re.exec(gap)) ends.push([a + m.index, a + m.index + m[0].length]);
  };
  // Brackets, and strings (whose text between leaves is their content, not a gap).
  let depth = 0;
  let at = from;
  for (let l = leafFrom(tree, 0); l !== NO_NODE; ) {
    const o = tree.ord(l);
    const start = src.starts[o] ?? -1;
    const t = tree.text(l);
    if (start >= from && t.length > 0) {
      if (start >= to) break;
      if (depth === 0) breaksIn(at, start);
      const k = tree.kindName(l);
      if (k === "string_start" || /^[([{]$/.test(t)) depth++;
      else if (k === "string_end" || /^[)\]}]$/.test(t)) depth = Math.max(0, depth - 1);
      at = start + t.length;
    }
    l = o + 1 < tree.nodeCount ? leafFrom(tree, 2 * (o + 1)) : NO_NODE;
  }
  if (depth === 0 && at < to) breaksIn(at, to);

  let first = true;
  let lineStart = from;
  const line = (end: number, newline: boolean) => {
    let s = lineStart;
    for (let i = 0; i < indentation && s < end && isWhitespace(text[s] ?? ""); i++) s++;
    if (s === end) {
      if (newline) sLine(first ? HARD | COLLAPSE : HARD | COLLAPSE | BLANK);
    } else {
      sLiteral(leafFrom(tree, 0), normalizeNewlines(text.slice(s, end)));
      if (newline) sLine(HARD | COLLAPSE);
    }
    first = false;
  };
  for (const [contentEnd, fullEnd] of ends) {
    if (contentEnd < from || fullEnd > to) continue;
    line(contentEnd, true);
    lineStart = fullEnd;
  }
  if (lineStart < to) line(to, false);
}

const markFormatted = (cs: readonly Comment[]) => {
  for (const c of cs) c.formatted = true;
};

/** Marks every comment inside positions `[start, end]` printed: they are part of a verbatim range. */
function markIn(f: Fmt, start: number, end: number): void {
  for (const c of f.comments.all) if (c.start >= start && c.end <= end) c.formatted = true;
}

// ---- comment ranges (ruff's `CommentRangeIter`) ----

type InSuppression =
  | { readonly k: "suppressed"; readonly comments: readonly Comment[] }
  | {
      readonly k: "ends";
      readonly suppressed: readonly Comment[];
      readonly on: Comment;
      readonly formatted: readonly Comment[];
      readonly off: Comment | undefined;
    };

/** Ruff's `CommentRangeIter::in_suppression`: `cs` split at each `fmt: on` and the `fmt: off` after it. */
function* inSuppression(f: Fmt, cs: readonly Comment[]): Generator<InSuppression> {
  let rest = cs;
  while (rest.length > 0) {
    const on = rest.findIndex((c) => isOn(f, c));
    if (on < 0) {
      yield { k: "suppressed", comments: rest };
      return;
    }
    const after = rest.slice(on + 1);
    const off = after.findIndex((c) => isOff(f, c));
    yield {
      k: "ends",
      suppressed: rest.slice(0, on),
      on: rest[on] as Comment,
      formatted: off < 0 ? after : after.slice(0, off),
      off: off < 0 ? undefined : after[off],
    };
    if (off < 0) return;
    rest = after.slice(off + 1);
  }
}

// ---- statements ----

/** The statements of a suite not printed yet, and how the suite prints one by its normal rules. */
export interface SuiteCursor {
  readonly body: readonly Stmt[];
  i: number;
  readonly write: (s: Stmt) => void;
}

const next = (c: SuiteCursor): Stmt | undefined => c.body[c.i++];

/**
 * The end of `s` with the comments that trail it or the last statement of its body, as ruff's range reaches, and
 * the `;` that ends the last statement, which is no statement's.
 */
function endWithTrailing(f: Fmt, s: Stmt): number {
  let end = s.end;
  for (let p: Py | undefined = s; p; p = lastChildInBody(p)) {
    const semi = firstToken(f.tree, p.end);
    if (semi?.kind === ";" && semi.end > end) end = semi.end;
    const last = f.comments.trailing(p).at(-1);
    if (last && last.end > end) end = last.end;
  }
  return end;
}

/**
 * Ruff's `write_suppressed_statements_starting_with_leading_comment`: `first` has a leading `fmt: off`. Prints
 * the comments before it, the `fmt: off`, then the statements from `first` as written. Returns the last statement.
 */
export function writeSuppressedFromLeading(f: Fmt, first: Stmt, cursor: SuiteCursor): Stmt {
  const leading = f.comments.leading(first);
  const at = leading.findIndex((c) => isOff(f, c));
  const off = leading[at] as Comment;
  f.writeLeading(leading.slice(0, at));
  f.writeComment(off);
  return writeSuppressed(f, off, first, leading.slice(at + 1), cursor);
}

/**
 * Ruff's `write_suppressed_statements_starting_with_trailing_comment`: `last` has a trailing own-line `fmt: off`.
 * Prints `last` with its comments up to it, then what follows as written. Returns the last statement printed.
 */
export function writeSuppressedFromTrailing(f: Fmt, last: Stmt, cursor: SuiteCursor): Stmt {
  const trailing = f.comments.trailing(last);
  const indentation = indentationOf(f, last);
  const at = trailing.findIndex((c) => isOff(f, c));
  let off = trailing[at] as Comment;
  const maybeSuppressed = trailing.slice(at + 1);
  markFormatted(maybeSuppressed);
  off.formatted = true;
  cursor.write(last);
  off.formatted = false;
  f.writeTrailing([off]);
  for (const r of inSuppression(f, maybeSuppressed)) {
    if (r.k === "suppressed") continue;
    r.on.formatted = false;
    writeVerbatimRange(f, offsetOf(f.tree, off.end), offsetOf(f.tree, r.on.start), indentation);
    f.writeTrailing([r.on]);
    for (const c of r.formatted) c.formatted = false;
    f.writeTrailing(r.formatted);
    if (!r.off) return last;
    r.off.formatted = false;
    f.writeTrailing([r.off]);
    off = r.off;
  }
  const following = next(cursor);
  if (following) return writeSuppressed(f, off, following, f.comments.leading(following), cursor);
  const lastComment = trailing.at(-1);
  if (lastComment)
    writeVerbatimRange(f, offsetOf(f.tree, off.end), offsetOf(f.tree, lastComment.end), indentation);
  return last;
}

/**
 * Ruff's `write_suppressed_statements`: the statements from `first` as written, from the end of `off` up to the
 * first `fmt: on` at their level, or the end of the suite. Returns the last statement printed.
 */
function writeSuppressed(
  f: Fmt,
  off: Comment,
  first: Stmt,
  firstLeading: readonly Comment[],
  cursor: SuiteCursor,
): Stmt {
  const cs = f.comments;
  let s = first;
  let leading = firstLeading;
  const indentation = indentationOf(f, first);
  const verbatimUpTo = (on: Comment) =>
    writeVerbatimRange(f, offsetOf(f.tree, off.end), offsetOf(f.tree, on.start), indentation);
  for (;;) {
    for (const r of inSuppression(f, leading)) {
      if (r.k === "suppressed") {
        markFormatted(r.comments);
        continue;
      }
      markFormatted(r.suppressed);
      verbatimUpTo(r.on);
      f.writeLeading([r.on]);
      f.writeLeading(r.formatted);
      if (r.off) {
        off = r.off;
        f.writeComment(off);
        continue;
      }
      if (cs.trailing(s).some((c) => isOff(f, c))) return writeSuppressedFromTrailing(f, s, cursor);
      cursor.write(s);
      return s;
    }
    markIn(f, s.start, s.end);
    for (const r of inSuppression(f, cs.trailing(s))) {
      if (r.k === "suppressed") {
        markFormatted(r.comments);
        continue;
      }
      markFormatted(r.suppressed);
      verbatimUpTo(r.on);
      f.writeComment(r.on);
      // At the end of the file, the break `format` ends it with would stack on this one.
      if (r.formatted.length > 0 || r.off) sLine(HARD | COLLAPSE);
      f.writeTrailing(r.formatted);
      if (!r.off) return s;
      off = r.off;
      f.writeComment(off);
    }
    const following = next(cursor);
    if (!following) {
      const end = endWithTrailing(f, s);
      markIn(f, s.start, end);
      writeVerbatimRange(f, offsetOf(f.tree, off.end), offsetOf(f.tree, end), indentation);
      return s;
    }
    s = following;
    leading = cs.leading(following);
  }
}

/**
 * Statements on one line with `;` between them, from `s` on: ruff keeps them as written together when the last
 * ends with a `fmt: skip`.
 */
export function sameLine(f: Fmt, body: readonly Stmt[], i: number): number {
  let j = i;
  for (let k = i + 1; k < body.length; k++) {
    const s = body[k] as Stmt;
    // After the `;` on its logical line: line continuations between, each line break inside one.
    let l = leafFrom(f.tree, s.start);
    let before = leafBefore(f.tree, s.start);
    while (before !== NO_NODE && f.tree.lf(l) === 0 && f.tree.kindName(before) === "line_continuation") {
      l = before;
      before = prevLeafOf(f.tree, before);
    }
    if (before === NO_NODE || f.tree.lf(l) > 0 || f.tree.text(before) !== ";") break;
    j = k;
  }
  return j;
}

/** The end of `last`'s line before the comments that trail it: `last`, and a `;` after it. */
function lineEnd(f: Fmt, last: Py, trailing = f.comments.trailing(last)): number {
  let end = last.end;
  const firstTrailing = trailing[0];
  for (const t of tokens(f.tree, last.end, firstTrailing ? firstTrailing.start : last.end))
    if (t.kind === ";") end = t.end;
  return end;
}

/**
 * Ruff's `FormatSuppressedNode` for the nodes `first` to `last` of one line (`last` with a `fmt: skip` among
 * `trailing`): their leading comments, their source up to the comment (a trailing `;` included), then `trailing`.
 */
export function writeSkipped(f: Fmt, first: Py, last: Py, trailing = f.comments.trailing(last)): void {
  const cs = f.comments;
  const end = lineEnd(f, last, trailing);
  f.writeLeading(cs.leading(first));
  markIn(f, first.start, end);
  writeVerbatimText(f, first.start, end);
  f.writeTrailing(trailing);
}

// ---- clauses ----

/**
 * The clause whose header prints as written: the dead interval its formatted header goes into, which its body
 * closes, and for a one-liner, the body's last statement, whose line printed with the header.
 */
let skipped: { readonly d: number; readonly last: Stmt | undefined } | undefined;

/** Forgets a clause left open by a format that failed inside its header. */
export function resetSkippedClause(): void {
  skipped = undefined;
}

/**
 * Ruff's `write_suppressed_clause_header`: a header from position `start` whose colon has a `fmt: skip` among
 * its comments `colon` prints as written, up to its colon; a header with its body on its line, the last
 * statement ending in a `fmt: skip`, prints with the body as written. Then what its rule writes up to the body
 * is written dead, and the body's custom calls `closeSkippedClause` first. Returns whether it is kept.
 */
export function openSkippedClause(
  f: Fmt,
  start: number,
  bodyStart: number,
  body: readonly Stmt[],
  colon: readonly Comment[],
): boolean {
  let colonTok: Tok | undefined;
  for (const t of tokens(f.tree, start, bodyStart)) colonTok = t;
  if (colonTok?.kind !== ":") return false;
  const first = body[0];
  const last = body.at(-1);
  const oneLiner =
    first !== undefined &&
    last !== undefined &&
    f.tree.lf(leafFrom(f.tree, first.start)) === 0 &&
    sameLine(f, body, 0) === body.length - 1 &&
    hasSkip(f, f.comments.trailing(last));
  if (!oneLiner && !hasSkip(f, colon)) return false;
  const end = oneLiner ? lineEnd(f, last) : colonTok.end;
  // A body that goes on past the colon's line formats, only its statements kept as written.
  if (oneLiner && /[\r\n]/.test(sourceOf(f.tree).text.slice(offsetOf(f.tree, colonTok.end), offsetOf(f.tree, end))))
    return false;
  markIn(f, start, end);
  writeVerbatimText(f, start, end);
  skipped = { d: openDead(), last: oneLiner ? last : undefined };
  return true;
}

/** Ends a kept header where its body starts. Returns whether the body printed with it, a one-liner's. */
export function closeSkippedClause(f: Fmt): boolean {
  const s = skipped;
  if (!s) return false;
  skipped = undefined;
  closeDead(s.d);
  if (!s.last) return false;
  f.writeTrailing(f.comments.trailing(s.last));
  return true;
}
