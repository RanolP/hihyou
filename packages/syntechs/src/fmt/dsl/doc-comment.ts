// Doc-comment reflow, which a spec turns on with `docComment` (dsl.ts): a KDoc, Javadoc or JSDoc comment's prose
// re-wrapped to the print width, with its code blocks, lists, tables and tags kept as blocks. The formatter only
// sees the tree, so this reads the comment token's text; it changes only the whitespace between words, which
// `docCommentWords` lets `check` hold it to.
import {
  close,
  closeChoice,
  closeState,
  FILL,
  FILL_ITEM,
  GROUP,
  open,
  openAlign,
  openChoice,
  openReservedSuffix,
  openState,
  sBreakParent,
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
/** Lines printed as written after the prefix: a fenced (`fence`) or indented code block, `<pre>`. */
interface Verbatim {
  readonly t: "fence" | "code" | "pre";
  readonly lines: string[];
  readonly blankBefore: boolean;
}
/** A column's alignment; ktfmt prints a left-aligned one (`:--`) as it does an unmarked one. */
type Align = "left" | "center" | "right";
/** A markdown table, its columns realigned: a header row, a divider (`aligns`), then the body rows. */
interface Table {
  readonly t: "table";
  /** The header row, then the body rows, each its cells' trimmed text; a body row may have more or fewer cells. */
  readonly rows: string[][];
  readonly aligns: Align[];
  readonly blankBefore: boolean;
}
export type DocBlock = Prose | Verbatim | Table;

const listMarker = /^(?:[-*+]|\d+[.)])(?=\s|$)/;
const fence = /^(```|~~~)/;
const split = (s: string) => s.split(/\s+/).filter((w) => w !== "");

/** A table row's cells: split at each unescaped `|`, less the leading and trailing one. */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** The column alignments of divider row `line`, or undefined when it is none: each cell `-`s, `:`-marked, 3+ long. */
function divider(line: string): Align[] | undefined {
  if (!line.includes("|")) return undefined;
  const cs = cells(line);
  if (!cs.every((c) => c.length >= 3 && /^:?-+:?$/.test(c))) return undefined;
  return cs.map((c) => (!c.endsWith(":") ? "left" : c.startsWith(":") ? "center" : "right"));
}

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
    // A table: a row with a `|`, a divider of as many cells, then the rows up to the first without a `|`. Only a
    // block's first line starts one; a paragraph's next line never does.
    const aligns = cur === undefined && line.includes("|") ? divider(lines[i + 1] ?? "") : undefined;
    const f = fence.exec(trimmed);
    if (f) verbatim("fence", i + 1, (l) => l.trimStart().startsWith(f[1] as string));
    else if (/^<pre\b/i.test(trimmed)) verbatim("pre", i, (l) => /<\/pre>/i.test(l));
    else if (indentOf(line) >= 4 && cur === undefined) {
      // An indented code block runs through the blank lines that more indented lines follow.
      let j = i;
      for (let k = i + 1; k < lines.length; k++) {
        const l = lines[k] as string;
        if (l.trim() === "") continue;
        if (indentOf(l) < 4) break;
        j = k;
      }
      verbatim("code", j, () => true);
    } else if (aligns !== undefined && aligns.length === cells(line).length) {
      const rows = [cells(line)];
      for (i += 2; i < lines.length && (lines[i] as string).includes("|"); i++) rows.push(cells(lines[i] as string));
      i--;
      blocks.push({ t: "table", rows, aligns, blankBefore });
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
 * Whether a blank line goes between `a` and `b`: the tags follow the prose after one and each other without, and
 * a header follows one. A `<pre>` hugs what precedes it, a fenced block the prose that introduces it (ending in
 * `:` or `,`) or another verbatim block, and a table its header; after a fenced block or a table, a list item
 * keeps the source's spacing.
 */
function blankBetween(a: DocBlock, b: DocBlock): boolean {
  if (b.t === "tag") return a.t !== "tag";
  if (b.t === "pre") return false;
  if (b.t === "fence") return a.t === "table" || !("lines" in a || /[:,]$/.test(a.words[a.words.length - 1] ?? ""));
  if (b.t === "header") return true;
  if (a.t === "tag") return true;
  if (isCode(a) && isCode(b)) return false;
  if ((a.t === "fence" || a.t === "table") && b.t === "item") return b.blankBefore;
  if (a.t === "header" && b.t === "table") return false;
  if (isCode(a) || isCode(b) || a.t === "table" || b.t === "table") return true;
  return b.blankBefore;
}

/** A word that would read as markup at the start of a line (a tag, a list marker, a header), so it never starts one. */
function canStartLine(word: string, style: DocCommentStyle): boolean {
  return !(word.startsWith(style.tag) || listMarker.test(word) || word.startsWith("#"));
}

/**
 * The words of doc comment `text` in order, joined by single spaces, and any other comment as written: what
 * `check` compares, since reflow may change only the whitespace between a doc comment's words.
 */
export function docCommentWords(text: string, style: DocCommentStyle): string {
  const blocks = parseDocComment(text, style);
  if (!blocks) return text;
  return blocks
    .flatMap((b) => {
      if ("lines" in b) return b.lines.flatMap(split);
      if (b.t !== "table") return b.words;
      // Realigning a table pads its cells, adds its outer `|`s and fills its short rows: its words are its cells'.
      const row = (r: readonly string[]) => {
        let end = r.length;
        while (end > 0 && r[end - 1] === "") end--;
        return `| ${r.slice(0, end).map((c) => split(c).join(" ")).join(" | ")} |`;
      };
      const [header, ...body] = b.rows;
      return [header as string[], b.aligns, ...body].map(row);
    })
    .join(" ");
}

/** `text` padded to `width` as `align` places it; a centered text's odd space goes after it. */
function pad(text: string, width: number, align: Align): string {
  const room = width - text.length;
  if (align === "right") return " ".repeat(room) + text;
  if (align === "center") {
    const before = Math.floor(room / 2);
    return " ".repeat(before) + text + " ".repeat(room - before);
  }
  return text + " ".repeat(room);
}

/**
 * Prints table `t` as ktfmt realigns one: each column as wide as its widest cell (3 at least), the header's
 * cells left-aligned and the body's as the divider says, the short rows filled with empty cells. A row's cells
 * sit between `| ` and ` |` when every row then ends within 2 columns past the width, else between bare `|`s.
 * A body row's cells past the header's print as they are, widening no other row.
 */
function printTable(t: Table): void {
  const count = t.aligns.length;
  const widths: number[] = [];
  for (const r of t.rows)
    r.forEach((c, i) => {
      widths[i] = Math.max(widths[i] ?? 3, c.length);
    });
  const rows = t.rows.map((r, j) =>
    Array.from({ length: Math.max(r.length, count) }, (_, i) =>
      pad(r[i] ?? "", widths[i] as number, j > 0 && i < count ? (t.aligns[i] as Align) : "left"),
    ),
  );
  const dashes = t.aligns.map((a, i) => (spaced: boolean) => {
    const n = (widths[i] as number) + (spaced ? 2 : 0);
    if (a === "center") return `:${"-".repeat(n - 2)}:`;
    if (a === "right") return `${"-".repeat(n - 1)}:`;
    return "-".repeat(n);
  });
  const lines = (spaced: boolean) => [
    spaced ? `| ${(rows[0] as string[]).join(" | ")} |` : `|${(rows[0] as string[]).join("|")}|`,
    `|${dashes.map((d) => d(spaced)).join("|")}|`,
    ...rows.slice(1).map((r) => (spaced ? `| ${r.join(" | ")} |` : `|${r.join("|")}|`)),
  ];
  const spaced = lines(true);
  const widest = Math.max(...spaced.map((l) => l.length));
  // The rows break the comment, which the choice's own lines would not.
  sBreakParent();
  openChoice(false);
  openState();
  // A state is measured to its first line break: the header row, whose last 2 columns print from a suffix that
  // reserves what makes it measure as the widest row less the 2 columns ktfmt allows past the width.
  const header = spaced[0] as string;
  sText(header.slice(0, -2));
  openReservedSuffix(widest - header.length);
  sText(header.slice(-2));
  close();
  for (const l of spaced.slice(1)) {
    sHardline();
    sText(l);
  }
  closeState();
  openState();
  lines(false).forEach((l, j) => {
    if (j > 0) sHardline();
    sText(l);
  });
  closeState();
  closeChoice();
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
    if (b.t === "table") {
      printTable(b);
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
