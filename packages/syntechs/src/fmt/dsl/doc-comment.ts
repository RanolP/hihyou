// Doc-comment reflow, which a spec turns on with `docComment` (dsl.ts): a KDoc, Javadoc or JSDoc comment's prose
// re-wrapped to the print width, with its code blocks, lists, tables and tags kept as blocks. The formatter only
// sees the tree, so this reads the comment token's text; it changes only the whitespace between words, which
// `docCommentWords` lets `check` hold it to.
import {
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  open,
  openAlign,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../stream.js";
import type { StreamCtx } from "../stream-format.js";

/** A doc comment's syntax: all a language configures to reflow its doc comments. */
export interface DocCommentStyle {
  /** What opens a doc comment (`/**`); a comment of the kind opened otherwise prints as written. */
  readonly open: string;
  readonly close: string;
  /** The mark each inner line starts with (`*`), printed between spaces after the indentation. */
  readonly prefix: string;
  /** What starts a tag at the start of a line (`@`): a tag is a block of its own, the tags after the prose. */
  readonly tag: string;
  /** How far a tag's wrapped lines hang past its first. */
  readonly tagHang: number;
}

/** KDoc as ktfmt 0.64 lays it out (its kdoc-formatter, greedy, `--kotlinlang-style`). */
export const kdoc: DocCommentStyle = { open: "/**", close: "*/", prefix: "*", tag: "@", tagHang: 2 };

/** Prose, whose words are re-wrapped: a paragraph, a list item, a tag, a header. */
interface Prose {
  readonly t: "para" | "item" | "tag" | "header";
  readonly words: string[];
  /** Printed before the first word: a nested list item's indentation. */
  readonly lead: string;
  /** How far past `lead` its wrapped lines hang. */
  readonly hang: number;
  readonly blankBefore: boolean;
}
/** Lines printed as written after the prefix: a fenced (`fence`) or indented code block, `<pre>`, a table. */
interface Verbatim {
  readonly t: "fence" | "code" | "pre" | "table";
  readonly lines: string[];
  readonly blankBefore: boolean;
}
export type DocBlock = Prose | Verbatim;

const listMarker = /^(?:[-*+]|\d+[.)])(?=\s|$)/;
const fence = /^(```|~~~)/;
const split = (s: string) => s.split(/\s+/).filter((w) => w !== "");

/** The comment's lines between its delimiters, each without its indentation, prefix and the space after it. */
function innerLines(text: string, style: DocCommentStyle): string[] {
  const body = text.slice(style.open.length, text.length - style.close.length);
  return body.split(/\r?\n/).map((l, i) => {
    let s = l.trimStart();
    if (i > 0 && s.startsWith(style.prefix)) s = s.slice(style.prefix.length);
    if (i === 0) s = s.trimStart();
    else if (s.startsWith(" ")) s = s.slice(1);
    return s.trimEnd();
  });
}

const isDoc = (text: string, style: DocCommentStyle) =>
  text.length >= style.open.length + style.close.length &&
  text.startsWith(style.open) &&
  text.endsWith(style.close);

/** `text`'s blocks, or undefined when it is not a doc comment of `style`. */
export function parseDocComment(text: string, style: DocCommentStyle): DocBlock[] | undefined {
  if (!isDoc(text, style)) return undefined;
  const lines = innerLines(text, style);
  const blocks: DocBlock[] = [];
  let blank = false;
  let cur: Prose | undefined;
  const indentOf = (l: string) => l.length - l.trimStart().length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const trimmed = line.trimStart();
    const blankBefore = blank && blocks.length > 0;
    if (trimmed === "") {
      blank = true;
      cur = undefined;
      continue;
    }
    blank = false;
    /** The lines from this one through the first at or after `from` that `last` holds of (else the last line). */
    const verbatim = (t: Verbatim["t"], from: number, last: (l: string) => boolean) => {
      let j = from;
      while (j < lines.length - 1 && !last(lines[j] as string)) j++;
      // An unclosed block runs to the comment's end, but not through the blank lines before its `*/`.
      while (j > i && (lines[j] as string).trim() === "") j--;
      blocks.push({ t, lines: lines.slice(i, j + 1), blankBefore });
      i = j;
      cur = undefined;
    };
    const f = fence.exec(trimmed);
    if (f) verbatim("fence", i + 1, (l) => l.trimStart().startsWith(f[1] as string));
    else if (/^<pre\b/i.test(trimmed)) verbatim("pre", i, (l) => /<\/pre>/i.test(l));
    else if (trimmed.startsWith("|")) {
      let j = i;
      while ((lines[j + 1] ?? "").trimStart().startsWith("|")) j++;
      verbatim("table", j, () => true);
    } else if (indentOf(line) >= 4 && cur === undefined) {
      // An indented code block runs through the blank lines that more indented lines follow.
      let j = i;
      for (let k = i + 1; k < lines.length; k++) {
        const l = lines[k] as string;
        if (l.trim() === "") continue;
        if (indentOf(l) < 4) break;
        j = k;
      }
      verbatim("code", j, () => true);
    } else if (trimmed.startsWith(style.tag) && trimmed.length > style.tag.length && !/\s/.test(trimmed[style.tag.length] as string)) {
      cur = { t: "tag", words: split(trimmed), lead: "", hang: style.tagHang, blankBefore };
      blocks.push(cur);
    } else if (listMarker.test(trimmed)) {
      const marker = (listMarker.exec(trimmed) as RegExpExecArray)[0];
      cur = { t: "item", words: split(trimmed), lead: " ".repeat(indentOf(line)), hang: marker.length + 1, blankBefore };
      blocks.push(cur);
    } else if (trimmed.startsWith("#")) {
      blocks.push({ t: "header", words: split(trimmed), lead: "", hang: 0, blankBefore });
      cur = undefined;
    } else if (cur) cur.words.push(...split(trimmed));
    else {
      cur = { t: "para", words: split(trimmed), lead: "", hang: 0, blankBefore };
      blocks.push(cur);
    }
  }
  return blocks;
}

const isCode = (b: DocBlock) => b.t === "code" || b.t === "fence";
/**
 * Whether a blank line goes between `a` and `b`: the tags follow the prose after one and each other without. A
 * `<pre>` hugs what precedes it, and a fenced block the prose that introduces it (ending in `:` or `,`) or
 * another verbatim block; after a fenced block, a list item keeps the source's spacing.
 */
function blankBetween(a: DocBlock, b: DocBlock): boolean {
  if (b.t === "tag") return a.t !== "tag";
  if (b.t === "pre") return false;
  if (b.t === "fence") return !("lines" in a || /[:,]$/.test(a.words[a.words.length - 1] ?? ""));
  if (a.t === "tag") return true;
  if (isCode(a) && isCode(b)) return false;
  if (a.t === "fence" && b.t === "item") return b.blankBefore;
  if (isCode(a) || isCode(b) || a.t === "table" || b.t === "table") return true;
  return b.blankBefore;
}

/** A word that would read as markup at the start of a line (a tag, a list marker, a header), so it never starts one. */
function canStartLine(word: string, style: DocCommentStyle): boolean {
  return !(word.startsWith(style.tag) || listMarker.test(word) || word.startsWith("#") || word.startsWith("|"));
}

/**
 * The words of doc comment `text` in order, joined by single spaces, and any other comment as written: what
 * `check` compares, since reflow may change only the whitespace between a doc comment's words.
 */
export function docCommentWords(text: string, style: DocCommentStyle): string {
  if (!isDoc(text, style)) return text;
  return innerLines(text, style).flatMap(split).join(" ");
}

/**
 * Prints comment `c`: a doc comment of `style` reflowed, on one line (`/** text *\/`) when it is one block of
 * prose that fits; any other comment as written.
 */
export function printDocComment<O>(c: number, ctx: StreamCtx<O>, style: DocCommentStyle): void {
  const text = ctx.tree.text(c);
  const blocks = ctx.isLineComment(c) ? undefined : parseDocComment(text, style);
  if (!blocks) {
    sToken(c, ctx.isLineComment(c) ? text.trimEnd() : text);
    return;
  }
  open(GROUP);
  sToken(c, style.open);
  openAlign(` ${style.prefix} `);
  sLine(0);
  blocks.forEach((b, i) => {
    if (i > 0) {
      sHardline();
      if (blankBetween(blocks[i - 1] as DocBlock, b)) sHardline();
    }
    if ("lines" in b) {
      b.lines.forEach((l, j) => {
        if (j > 0) sHardline();
        if (l !== "") sText(l);
      });
      return;
    }
    if (b.lead !== "") sText(b.lead);
    const hang = b.lead.length + b.hang;
    if (hang > 0) openAlign(hang);
    open(FILL);
    let item = "";
    b.words.forEach((w, j) => {
      if (j > 0 && canStartLine(w, style)) {
        open(FILL_ITEM);
        sText(item);
        close();
        sLine(0);
        item = w;
      } else item = item === "" ? w : `${item} ${w}`;
    });
    open(FILL_ITEM);
    sText(item);
    close();
    close();
    if (hang > 0) close();
  });
  close();
  openAlign(" ");
  sLine(0);
  close();
  sText(style.close);
  close();
}
