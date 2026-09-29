// Doc-comment reflow, which a spec turns on with `docComment` (dsl.ts): a KDoc comment's prose re-wrapped to the
// print width as ktfmt 0.64's kdoc formatter lays it out. `buildParagraphs` ports its ParagraphListBuilder (with
// the options KDocCommentsHelper sets: no markup conversion, `@param[x]` kept, nested lists 4 deep, greedy
// breaking); the printer fills each paragraph's words to the width. The formatter only sees the tree, so this reads
// the comment token's text; it changes only the whitespace between words and the order of the tags, which
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
}

/** KDoc as ktfmt 0.64 lays it out (its kdoc-formatter, greedy, `--kotlinlang-style`). */
export const kdoc: DocCommentStyle = { open: "/**", close: "*/", prefix: "*" };

/** A column's alignment; ktfmt prints a left-aligned one (`:--`) as it does an unmarked one. */
type Align = "left" | "center" | "right";
/** A markdown table, its columns realigned: a header row, a divider (`aligns`), then the body rows. */
interface Table {
  /** The header row, then the body rows, each its cells' trimmed text; a body row may have more or fewer cells. */
  readonly rows: string[][];
  readonly aligns: Align[];
}

/** ktfmt's Paragraph: one block of the comment, printed from a new line. */
interface Paragraph {
  text: string;
  /** A blank line goes before it. */
  separate: boolean;
  /** A list item's text after a blank line: every line hangs, the first too. */
  continuation: boolean;
  /** Kept though empty: a blank line of a code block. */
  allowEmpty: boolean;
  /** Printed as written: a code block's line, `<pre>`, a `<!--` directive. */
  preformatted: boolean;
  /** Starts on a line of its own; the next paragraph is not a paragraph of prose continuing it. */
  block: boolean;
  /** A KDoc tag (`@param`). */
  doc: boolean;
  /** How many `> ` each line starts with. */
  quoted: number;
  table: Table | undefined;
  /** A `---` line between blank lines. */
  separator: boolean;
  /** Its lines after the first hang by `hangingIndent` (a list item, a tag, a TODO); implies `block`. */
  hanging: boolean;
  originalIndent: number;
  /** Before every line: a nested list item's indentation. */
  indent: string;
  hangingIndent: string;
  prev: Paragraph | undefined;
}

const newParagraph = (): Paragraph => ({
  text: "",
  separate: false,
  continuation: false,
  allowEmpty: false,
  preformatted: false,
  block: false,
  doc: false,
  quoted: 0,
  table: undefined,
  separator: false,
  hanging: false,
  originalIndent: 0,
  indent: "",
  hangingIndent: "",
  prev: undefined,
});
const hang = (p: Paragraph) => {
  p.hanging = true;
  p.block = true;
  return p;
};

const isBlank = (s: string) => s.trim() === "";
const startsCI = (s: string, prefix: string) => s.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
const equalsCI = (s: string, other: string) => s.toLowerCase() === other.toLowerCase();
const endsCI = (s: string, suffix: string) => s.toLowerCase().endsWith(suffix.toLowerCase());
const containsOnly = (s: string, chars: string) => [...s].every((c) => chars.includes(c));
const isWhitespace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isLetter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
const isListItem = (s: string) =>
  s.startsWith("- ") || s.startsWith("* ") || s.startsWith("+ ") || /^\d+[.)] /.test(s) || startsCI(s, "<li>");
const isTodo = (s: string) => s.startsWith("TODO:") || s.startsWith("TODO(");
const isHeader = (s: string) => s.startsWith("#") || startsCI(s, "<h");
const isQuoted = (s: string) => s.startsWith("> ");
const isDirectiveMarker = (s: string) => s.startsWith("<!--") || s.startsWith("-->");
const isExpectingMore = (s: string) => /[:,]\s*$/.test(s);
/** A divider line of `minCount` or more `-`s or `_`s (and spaces). */
const isLine = (s: string, minCount = 3) =>
  (s.startsWith("-") && containsOnly(s, "- ") && [...s].filter((c) => c === "-").length >= minCount) ||
  (s.startsWith("_") && containsOnly(s, "_ ") && [...s].filter((c) => c === "_").length >= minCount);

function isKDocTag(s: string): boolean {
  if (!s.startsWith("@") || s.length <= 1) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s[i] as string;
    if (isWhitespace(c)) return i > 2;
    if (!isLetter(c) || c === c.toUpperCase()) {
      if (c === "[" && (s.startsWith("@param") || s.startsWith("@property"))) return true;
      return i === 1 && isLetter(c) && c === c.toUpperCase() && c !== c.toLowerCase();
    }
  }
  return true;
}

/** Runs of spaces collapsed to one (ktfmt's quirk: leading spaces dropped), trailing whitespace trimmed. */
function collapseSpaces(s: string): string {
  if (!s.includes("  ")) return s.trimEnd();
  let out = "";
  let prev = s[0];
  for (const c of s) {
    if (prev === " " && c === " ") continue;
    out += c;
    prev = c;
  }
  return out.trimEnd();
}

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

/** Whether `text` is a doc comment of `style`, which ktfmt, as google-java-format does a Javadoc, ends the line after. */
export const isDocComment = (text: string, style: DocCommentStyle): boolean =>
  text.length >= style.open.length + style.close.length &&
  text.startsWith(style.open) &&
  text.endsWith(style.close);

/** ktfmt's ParagraphListBuilder.scan then arrange: the paragraphs of doc comment `text`, in printing order. */
function buildParagraphs(text: string, style: DocCommentStyle): Paragraph[] {
  const inner = text.slice(style.open.length, text.length - style.close.length);
  const lines = text.includes("\n") ? inner.trim().split("\n") : [`${style.prefix} ${inner.trim()}`];
  const lineContent = (line: string) => {
    const t = line.trim();
    if (t.startsWith(`${style.prefix} `)) return t.slice(style.prefix.length + 1);
    return t.startsWith(style.prefix) ? t.slice(style.prefix.length) : t;
  };
  const indentOf = (s: string) => s.length - s.trimStart().length;
  const paragraphs: Paragraph[] = [];
  let paragraph = newParagraph();
  const appendText = (s: string) => {
    paragraph.text += s;
  };
  const closeParagraph = () => {
    const t = paragraph.text;
    if (paragraph.preformatted) {
      // as written
    } else if (isKDocTag(t)) {
      paragraph.doc = true;
      hang(paragraph);
    } else if (isTodo(t) || isListItem(t)) hang(paragraph);
    else if (isDirectiveMarker(t)) {
      paragraph.block = true;
      paragraph.preformatted = true;
    }
    if (paragraph.text !== "" || paragraph.allowEmpty) paragraphs.push(paragraph);
  };
  const next = () => {
    closeParagraph();
    const prev = paragraph;
    paragraph = newParagraph();
    paragraph.prev = prev;
    return paragraph;
  };
  const stripTrailingBlankLines = () => {
    while (paragraphs.length > 0 && (paragraphs[paragraphs.length - 1] as Paragraph).text === "") paragraphs.pop();
  };

  const addLines = (
    i: number,
    includeEnd: boolean,
    until: (j: number, w: string, s: string) => boolean,
    customize: (j: number, p: Paragraph) => void,
    shouldBreak: (w: string) => boolean,
  ): number => {
    let j = i;
    while (j < lines.length) {
      const withIndent = lineContent(lines[j] as string);
      const trimmed = withIndent.trim();
      if (!includeEnd && j > i && until(j, trimmed, withIndent)) {
        stripTrailingBlankLines();
        return j;
      }
      if (shouldBreak(trimmed)) next();
      appendText(collapseSpaces(isQuoted(withIndent) ? trimmed.slice(2) : trimmed));
      appendText(" ");
      customize(j, paragraph);
      if (includeEnd && j > i && until(j, trimmed, withIndent)) {
        stripTrailingBlankLines();
        return j + 1;
      }
      j++;
    }
    stripTrailingBlankLines();
    next();
    return j;
  };

  /** Lines from `i` as written, each a paragraph, through (`includeEnd`) or up to the first `until` holds of. */
  const addPreformatted = (i: number, includeStart: boolean, includeEnd: boolean, until: (s: string) => boolean) => {
    next();
    let j = i;
    while (j < lines.length) {
      const done = (includeStart || j > i) && until(lineContent(lines[j] as string));
      if (!includeEnd && done) break;
      j++;
      if (includeEnd && done) break;
    }
    for (let k = i; k < j; k++) {
      appendText(lineContent(lines[k] as string));
      paragraph.preformatted = true;
      paragraph.allowEmpty = true;
      next();
    }
    stripTrailingBlankLines();
    next();
    return j;
  };

  const addPlainText = (i: number, t: string, braceBalance = 0): number => {
    const s = collapseSpaces(t);
    appendText(s);
    appendText(" ");
    // An inline tag (`{@link ...}`) left open takes the lines up to its `}`, whatever they start with.
    const open = braceBalance > 0 ? 0 : s.indexOf("{@");
    if (open !== -1 && s.indexOf("}", open) === -1 && i < lines.length) {
      const following = lineContent(lines[i] as string).trim();
      if (isBlank(following) || following.startsWith("```")) return i;
      return addPlainText(i + 1, following, 1);
    }
    return i;
  };

  let i = 0;
  while (i < lines.length) {
    const l = lines[i++] as string;
    const withIndent = lineContent(l);
    const trimmed = withIndent.trim();
    /** A new paragraph, its original indentation line `at`'s. */
    const nextAt = (at: number) => {
      const p = next();
      if (at >= 0 && at < lines.length) {
        const line = lines[at] === l ? withIndent : lineContent(lines[at] as string);
        p.originalIndent = indentOf(line);
      }
      return p;
    };

    if (
      withIndent.startsWith("    ") &&
      (i === 1 || isBlank(lineContent(lines[i - 2] as string))) &&
      (paragraph.prev === undefined || indentOf(withIndent) >= paragraph.prev.originalIndent + 4)
    ) {
      // Markdown's indented code block.
      i = addPreformatted(i - 1, false, false, (s) => !s.startsWith(" "));
    } else if (trimmed.startsWith("-") && containsOnly(trimmed, "-| ")) {
      const p = nextAt(i - 1);
      appendText(trimmed);
      nextAt(i).block = true;
      if (
        isLine(withIndent) &&
        (i < 2 || isBlank(lineContent(lines[i - 2] as string))) &&
        (i > lines.length - 1 || isBlank(lineContent(lines[i] as string)))
      )
        p.separator = true;
    } else if (
      (trimmed.startsWith("=") && containsOnly(trimmed, "= ")) ||
      (trimmed.startsWith("#") && [...trimmed].find((c) => c !== "#") === " ") ||
      (trimmed.startsWith("*") && containsOnly(trimmed, "* "))
    ) {
      // A `===` underline, a `## header`, a `***` or `* * *` rule: a line of its own.
      nextAt(i - 1).block = true;
      appendText(trimmed);
      nextAt(i).block = true;
    } else if (trimmed.startsWith("```")) {
      i = addPreformatted(i - 1, false, true, (s) => s.trimStart().startsWith("```"));
    } else if (startsCI(trimmed, "<pre>")) {
      i = addPreformatted(i - 1, true, true, (s) => s.toLowerCase().includes("</pre>"));
    } else if (isQuoted(trimmed)) {
      const hadBlankLine = paragraph.text === "" && paragraph.separate;
      i--;
      let prevDepth = 0;
      let first = true;
      while (i < lines.length) {
        const q = lineContent(lines[i] as string).trim();
        if (isBlank(q) || isKDocTag(q) || isTodo(q) || isDirectiveMarker(q) || isHeader(q)) break;
        if (!isQuoted(q) && isListItem(q)) break;
        let depth = prevDepth;
        let content = q;
        if (isQuoted(q)) {
          depth = 0;
          while (content.startsWith("> ")) {
            depth++;
            content = content.slice(2).trimStart();
          }
        }
        if (first || depth !== prevDepth || isListItem(content)) {
          const p = nextAt(i);
          if (first && hadBlankLine) p.separate = true;
          p.quoted = depth;
          p.block = false;
        }
        appendText(collapseSpaces(content));
        appendText(" ");
        prevDepth = depth;
        first = false;
        i++;
      }
      nextAt(i);
    } else if (equalsCI(trimmed, "<ul>") || equalsCI(trimmed, "<ol>")) {
      nextAt(i - 1).block = true;
      appendText(trimmed);
      hang(nextAt(i));
      i = addLines(
        i,
        true,
        (_, w) => equalsCI(w, "</ul>") || equalsCI(w, "</ol>"),
        (_, p) => {
          p.block = true;
        },
        (w) => startsCI(w, "<li>") || startsCI(w, "</ul>") || startsCI(w, "</ol>"),
      );
      nextAt(i);
    } else if (isListItem(trimmed) || isKDocTag(trimmed) || isTodo(trimmed)) {
      const hadBlankLine = paragraph.text === "" && paragraph.separate && isListItem(trimmed);
      i--;
      hang(nextAt(i));
      if (hadBlankLine) paragraph.separate = true;
      const start = i;
      const itemUntil = (j: number, w: string, s: string) => {
        // A blank line before an indented one continues the item.
        if (isBlank(s) && j < lines.length - 1 && lineContent(lines[j + 1] as string).startsWith(" ")) return false;
        return (
          isBlank(s) ||
          isListItem(w) ||
          isQuoted(w) ||
          isKDocTag(w) ||
          isTodo(w) ||
          w.startsWith("```") ||
          w.startsWith("<pre>") ||
          isDirectiveMarker(w) ||
          isLine(w) ||
          isHeader(w) ||
          // Not indented by at least two spaces following a blank line.
          (s.length > 2 &&
            (!isWhitespace(s[0]) || !isWhitespace(s[1])) &&
            j < lines.length - 1 &&
            isBlank(lineContent(lines[j - 1] as string)))
        );
      };
      const itemCustomize = (j: number, p: Paragraph) => {
        if (isBlank(lineContent(lines[j] as string)) && j >= start) {
          hang(p);
          p.continuation = true;
        }
      };
      const itemBreak = (w: string) => isBlank(w);
      i = addLines(i, false, itemUntil, itemCustomize, itemBreak);
      // A fenced code block within the item, and the item's text after it.
      while (i < lines.length && lineContent(lines[i] as string).trim().startsWith("```")) {
        i = addPreformatted(i, false, true, (s) => s.trimStart().startsWith("```"));
        if (i >= lines.length) break;
        const following = lineContent(lines[i] as string);
        const f = following.trim();
        const continues = isBlank(f)
          ? i + 1 < lines.length && lineContent(lines[i + 1] as string).startsWith(" ")
          : following.startsWith(" ") &&
            !isListItem(f) &&
            !isQuoted(f) &&
            !isKDocTag(f) &&
            !isTodo(f) &&
            !isDirectiveMarker(f) &&
            !isLine(f) &&
            !isHeader(f);
        if (!continues) break;
        const p = hang(nextAt(i));
        p.continuation = true;
        i = addLines(i, false, itemUntil, itemCustomize, itemBreak);
      }
      nextAt(i);
    } else if (trimmed === "") {
      nextAt(i).separate = true;
    } else if (isDirectiveMarker(trimmed)) {
      nextAt(i - 1);
      appendText(trimmed);
      nextAt(i).block = true;
    } else {
      // A table: a row with a `|`, a divider of as many cells, then the rows up to the first without a `|`.
      const aligns =
        trimmed.includes("|") && paragraph.text === "" && (i < 2 || !(lines[i - 2] as string).includes("---"))
          ? divider(lineContent(lines[i] ?? ""))
          : undefined;
      if (aligns !== undefined && aligns.length === cells(trimmed).length) {
        const rows = [cells(trimmed)];
        const raw = [trimmed, lineContent(lines[i] as string).trim()];
        for (i++; i < lines.length && lineContent(lines[i] as string).includes("|"); i++) {
          const row = lineContent(lines[i] as string).trim();
          raw.push(row);
          rows.push(cells(row));
        }
        appendText(raw.join(" "));
        paragraph.table = { rows, aligns };
        paragraph.separate = true;
        paragraph.block = true;
        nextAt(-1);
        nextAt(i);
        continue;
      }
      // Some common HTML block tags start a paragraph.
      const blockTags = ["<p>", "<p/>", "<h1", "<h2", "<h3", "<h4", "<table", "<tr", "<caption", "<td", "<div"];
      if (blockTags.some((t) => startsCI(trimmed, t))) {
        nextAt(i - 1).block = true;
        if (equalsCI(trimmed, "<p>") || equalsCI(trimmed, "<p/>")) {
          appendText(trimmed);
          nextAt(i).block = true;
          continue;
        }
        if (["</h1>", "</h2>", "</h3>", "</h4>"].some((t) => endsCI(trimmed, t))) {
          appendText(collapseSpaces(trimmed));
          nextAt(i).block = true;
          continue;
        }
      }
      i = addPlainText(i, trimmed);
    }
  }
  closeParagraph();
  if (paragraphs.length === 0) return paragraphs;
  const sorted = sortDocTags(paragraphs);
  adjustSeparators(sorted);
  adjustIndentation(sorted);
  removeBlankParagraphs(sorted);
  while (sorted.length > 0 && (sorted[sorted.length - 1] as Paragraph).text === "") sorted.pop();
  return sorted;
}

/** Canonical KDoc tag order (kotlinlang.org's block tags); a leading `@sample` stays first. */
function docTagRank(tag: string, priority: boolean): number {
  if (priority) return -1;
  const order = ["@param", "@property", "@return", "@constructor", "@receiver", "@throws", "@exception"];
  const rest = ["@sample", "@see", "@author", "@since", "@suppress", "@deprecated"];
  if (tag.startsWith(order[0] as string) || tag.startsWith(order[1] as string)) return 0;
  for (const [k, t] of order.slice(2).entries()) if (tag.startsWith(t)) return k + 1;
  for (const [k, t] of rest.entries()) if (tag.startsWith(t)) return k + 6;
  return 100;
}

/**
 * The tags after the prose, in canonical order, each with the paragraphs that follow it up to the next, and the
 * TODOs last; the rest keeps its order.
 */
function sortDocTags(paragraphs: Paragraph[]): Paragraph[] {
  if (!paragraphs.some((p) => p.doc)) return paragraphs;
  const order = new Map(paragraphs.map((p, k) => [p, k]));
  const isPriority = (p: Paragraph) => p.text.startsWith("@sample");
  const firstNonPriority = paragraphs.findIndex((p) => p.doc && !isPriority(p));
  const units: Paragraph[][] = [];
  let tag: Paragraph[] | undefined;
  for (const p of paragraphs) {
    if (p.doc) {
      tag = [];
      units.push(tag);
    }
    if (tag !== undefined && !isTodo(p.text)) tag.push(p);
    else units.push([p]);
  }
  units.sort((u1, u2) => {
    const p1 = u1[0] as Paragraph;
    const p2 = u2[0] as Paragraph;
    const o1 = order.get(p1) as number;
    const o2 = order.get(p2) as number;
    if (isTodo(p1.text) !== isTodo(p2.text)) return isTodo(p1.text) ? 1 : -1;
    if (p1.doc !== p2.doc) return p1.doc ? 1 : -1;
    if (p1.doc) {
      const r1 = docTagRank(p1.text, isPriority(p1) && o1 < firstNonPriority);
      const r2 = docTagRank(p2.text, isPriority(p2) && o2 < firstNonPriority);
      if (r1 !== r2) return r1 - r2;
    }
    return o1 - o2;
  });
  const out = units.flat();
  out.forEach((p, k) => {
    p.prev = out[k - 1];
  });
  return out;
}

/** Whether a blank line goes before each paragraph, and how far a hanging one's lines hang. */
function adjustSeparators(paragraphs: Paragraph[]): void {
  let prev: Paragraph | undefined;
  for (const p of paragraphs) {
    const t = p.text;
    p.separate = (() => {
      if (prev === undefined) return false;
      if (p.preformatted && prev.preformatted) return false;
      if (p.table) return p.separate && (!prev.block || isKDocTag(prev.text) || prev.table !== undefined);
      if (p.separator || prev.separator) return true;
      if (isLine(t, 1) || isLine(prev.text, 1)) return false;
      if (p.separate) return true;
      if (p.doc) return !prev.doc;
      if (isDirectiveMarker(t)) return false;
      if (isTodo(t) && !isTodo(prev.text)) return true;
      if (isHeader(t)) return true;
      // A code block is set off, but `<pre>` hugs, and a fence hugs the prose introducing it.
      if (p.preformatted)
        return !prev.preformatted && !startsCI(t, "<pre") && (!t.trimStart().startsWith("```") || !isExpectingMore(prev.text));
      if (prev.preformatted && startsCI(prev.text, "</pre>")) return false;
      if (p.continuation) return true;
      if (p.hanging) return false;
      if (p.quoted > 0) return prev.quoted > 0 && p.quoted === prev.quoted;
      if (startsCI(t, "<p>") || startsCI(t, "<p/>")) return true;
      return !p.block && t !== "";
    })();
    if (p.hanging) {
      if (p.doc || startsCI(t, "<li>") || isTodo(t)) p.hangingIndent = "  ";
      else if (p.continuation && p.prev !== undefined) {
        // The list item's own hang, past any code block between.
        let source = p.prev;
        while ((source.preformatted || source.text === "") && source.prev !== undefined) source = source.prev;
        p.hangingIndent = source.hangingIndent;
        p.text = p.text.trimStart();
      } else p.hangingIndent = " ".repeat(t.indexOf(" ") + 1);
    }
    prev = p;
  }
}

/** A nested list's items indented 4 per level; the outermost list, however indented, not at all. */
function adjustIndentation(paragraphs: Paragraph[]): void {
  const firstIndent = (paragraphs[0] as Paragraph).originalIndent;
  if (firstIndent > 0) for (const p of paragraphs) if (p.originalIndent <= firstIndent) p.originalIndent = 0;
  let inList = (paragraphs[0] as Paragraph).hanging;
  let startIndent = 0;
  const levels = new Set<number>();
  for (const p of paragraphs.slice(1)) {
    if (!inList) {
      if (p.hanging) {
        inList = true;
        startIndent = p.originalIndent;
      }
    } else if (!p.hanging) inList = false;
    else if (p.originalIndent === startIndent) p.originalIndent = 0;
    else if (p.originalIndent > 0) levels.add(p.originalIndent);
  }
  const assigned = new Map([...levels].sort((a, b) => a - b).map((n, k) => [n, (k + 1) * 4]));
  for (const p of paragraphs) {
    const n = assigned.get(p.originalIndent);
    if (p.originalIndent > 0 && n !== undefined) {
      p.originalIndent = n;
      p.indent = " ".repeat(n);
    }
  }
}

/** Empty paragraphs (but a code block's blank lines) dropped, a blank line they stood for kept. */
function removeBlankParagraphs(paragraphs: Paragraph[]): void {
  for (let k = paragraphs.length - 2; k >= 0; k--) {
    const p = paragraphs[k] as Paragraph;
    if (p.text === "" && !p.preformatted) {
      if (p.separate) (paragraphs[k + 1] as Paragraph).separate = true;
      paragraphs.splice(k, 1);
    }
  }
}

const split = (s: string) => s.split(/\s+/).filter((w) => w !== "");

/** Whether `word` may start a line: nothing that would read as markup there (a tag, a list marker, a quote...). */
function canBreakAt(prev: string, word: string): boolean {
  if (
    word.startsWith("#") ||
    word.startsWith("```") ||
    isDirectiveMarker(word) ||
    word.startsWith("@") ||
    isTodo(word) ||
    word.startsWith(">")
  )
    return false;
  if (prev === "@sample") return false;
  if (!isLetter(word[0])) {
    const spaced = `${word} `;
    if ((isListItem(spaced) && !equalsCI(word, "<li>")) || isQuoted(spaced)) return false;
  }
  return true;
}

/**
 * ktfmt's computeWords: `p`'s words, those no line may break between joined into one, such as a list marker and
 * its first word, a `[link text]`, and a word before one that would read as markup at a line's start.
 */
function computeWords(p: Paragraph): string[] {
  const words = split(p.text);
  if (words.length <= 1) return words;
  const combined: string[] = [];
  let from = 0;
  while (from < words.length) {
    const start = from === 0 && (p.quoted > 0 || (p.hanging && !isKDocTag(p.text))) ? from + 2 : from + 1;
    let to = words.length;
    for (let k = start; k < words.length; k++) {
      const w = words[k] as string;
      if (w.startsWith("[") && !w.startsWith("[[")) {
        const j = words.findIndex((x, m) => m >= k && x.includes("]"));
        if (j !== -1) {
          // Link text never breaks.
          if (start === from + 1 && canBreakAt(words[start - 1] as string, words[start] as string)) {
            combined.push(words[from] as string);
            from = start;
          }
          to = j + 1;
          if (to === words.length || canBreakAt(words[to - 1] as string, words[to] as string)) break;
        }
      } else if (canBreakAt(words[k - 1] as string, w)) {
        to = k;
        break;
      }
    }
    if (to > from) combined.push(words.slice(from, to).join(" "));
    from = to;
  }
  return combined;
}

/**
 * The words of doc comment `text` in printing order, joined by single spaces, and any other comment as written:
 * what `check` compares, since reflow may change only the whitespace between a doc comment's words and the order
 * of its tags.
 */
export function docCommentWords(text: string, style: DocCommentStyle): string {
  if (!isDocComment(text, style)) return text;
  return buildParagraphs(text, style)
    .flatMap((p) => {
      if (p.table === undefined) return split(p.text);
      // Realigning a table pads its cells, adds its outer `|`s and fills its short rows: its words are its cells'.
      const row = (r: readonly string[]) => {
        let end = r.length;
        while (end > 0 && r[end - 1] === "") end--;
        return `| ${r.slice(0, end).map((c) => split(c).join(" ")).join(" | ")} |`;
      };
      const [header, ...body] = p.table.rows;
      return [header as string[], p.table.aligns, ...body].map(row);
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

/** Prints prose paragraph `p`: its words filled to the width, every line after the first hanging. */
function printProse(p: Paragraph): void {
  const quote = "> ".repeat(p.quoted);
  const lead = p.indent + (p.continuation ? p.hangingIndent : "") + quote;
  const align = p.indent + p.hangingIndent + quote;
  if (lead !== "") sText(lead);
  if (align !== "") openAlign(align);
  open(FILL);
  computeWords(p).forEach((w, j) => {
    if (j > 0) sLine(0);
    open(FILL_ITEM);
    sText(w);
    close();
  });
  close();
  if (align !== "") close();
}

/**
 * Prints comment `c`: a doc comment of `style` reflowed, on one line (`/** text *\/`) when it is one paragraph
 * that fits; any other comment as written.
 */
export function printDocComment<O>(c: number, ctx: StreamCtx<O>, style: DocCommentStyle): void {
  const text = ctx.tree.text(c);
  if (ctx.isLineComment(c) || !isDocComment(text, style)) {
    sToken(c, ctx.isLineComment(c) ? text.trimEnd() : text);
    return;
  }
  const paragraphs = buildParagraphs(text, style);
  open(GROUP);
  sToken(c, style.open);
  openAlign(` ${style.prefix} `);
  sLine(0);
  paragraphs.forEach((p, i) => {
    if (i > 0) {
      sHardline();
      if (p.separate) sHardline();
    }
    if (p.table !== undefined) printTable(p.table);
    else if (p.preformatted) {
      const l = p.text.trimEnd();
      if (l !== "") sText(l);
    } else printProse(p);
  });
  close();
  openAlign(" ");
  sLine(0);
  close();
  sText(style.close);
  close();
}
