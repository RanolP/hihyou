import type { FormatTree } from "../../../fmt/tree.js";
import { textWidth } from "../../../fmt/width.js";
import type { Comment, Comments } from "./comments.js";
import { isPragma, normalizeComment } from "./comments.js";
import type { FState } from "./strings.js";
import * as sink from "./sink.js";
import { linesAfter, linesBefore, startOf, tokens } from "./trivia.js";

/** Ruff's `format.*` options the Python rules read, by ruff's names. */
export interface PyOptions {
  "line-length": number;
  "indent-width": number;
  "indent-style": "space" | "tab";
  "line-ending": "auto" | "lf" | "cr-lf" | "native";
  "quote-style": "double" | "single" | "preserve";
  "skip-magic-trailing-comma": boolean;
}

/**
 * Ruff's `NodeLevel`: where the node being printed stands, which decides what an in-parentheses-only break
 * becomes and how many blank lines a comment keeps. `g` is the stream id of the group of the optional parentheses around.
 */
export type Level =
  | { readonly k: "top" }
  | { readonly k: "compound" }
  | { readonly k: "expr"; readonly g: number | undefined }
  | { readonly k: "paren" };

export const TOP: Level = { k: "top" };
export const COMPOUND: Level = { k: "compound" };
export const PAREN: Level = { k: "paren" };
export const EXPR: Level = { k: "expr", g: undefined };

/** The state one formatting run threads through the rules. */
export class Fmt {
  level: Level = TOP;
  /** How many suites deep the statement being printed is: the indentation a docstring's lines take. */
  depth = 0;
  /** Whether an f-string's interpolation is being printed, and that string's quotes. */
  fstr: FState = { k: "outside" };

  constructor(
    readonly tree: FormatTree,
    readonly options: PyOptions,
    readonly comments: Comments,
  ) {}

  at<T>(level: Level, fn: () => T): T {
    const saved = this.level;
    this.level = level;
    try {
      return fn();
    } finally {
      this.level = saved;
    }
  }

  text(n: number): string {
    return this.tree.text(n);
  }

  writeTok(n: number, as?: string): void {
    sink.sToken(n, as ?? this.tree.text(n));
  }

  /** A comment as printed; marks it printed. */
  writeComment(c: Comment): void {
    c.formatted = true;
    sink.sToken(c.ts, normalizeComment(this.tree.text(c.ts)));
  }

  /** Ruff's empty lines after a comment: how many blank lines the level keeps of the `n` line breaks. */
  writeEmptyLines(n: number): void {
    const one = sink.HARD | sink.COLLAPSE;
    const blank = one | sink.BLANK;
    switch (this.level.k) {
      case "top":
        if (n <= 1) sink.sLine(one);
        else {
          sink.sLine(blank);
          if (n > 2) sink.sLine(blank);
        }
        return;
      case "compound":
        sink.sLine(n <= 1 ? one : blank);
        return;
      default:
        sink.sLine(one);
    }
  }

  writeLeading(cs: readonly Comment[]): void {
    for (const c of cs) {
      if (c.formatted) continue;
      this.writeComment(c);
      this.writeEmptyLines(linesAfter(this.tree, c.end));
    }
  }

  writeTrailing(cs: readonly Comment[]): void {
    let ownLine = false;
    for (const c of cs) {
      if (c.formatted) continue;
      ownLine ||= c.line === "own";
      if (ownLine) {
        sink.open(sink.LINE_SUFFIX);
        this.writeEmptyLines(linesBefore(this.tree, c.start));
        this.writeComment(c);
        sink.close();
        sink.sBreakParent();
      } else this.writeEolComment(c);
    }
  }

  writeEolComment(c: Comment): void {
    const s = normalizeComment(this.tree.text(c.ts));
    // A pragma comment reserves no columns: the line it ends may overflow for it.
    if (isPragma(s)) sink.open(sink.LINE_SUFFIX);
    else sink.openReservedSuffix(2 + textWidth(s));
    sink.sText("  ");
    this.writeComment(c);
    sink.close();
    sink.sBreakParent();
  }

  writeDangling(cs: readonly Comment[]): void {
    let first = true;
    for (const c of cs) {
      if (c.formatted) continue;
      if (first) {
        if (c.line === "own") sink.sLine(sink.HARD | sink.COLLAPSE);
        else sink.sText("  ");
      }
      this.writeComment(c);
      this.writeEmptyLines(linesAfter(this.tree, c.end));
      first = false;
    }
  }

  writeDanglingOpenParen(cs: readonly Comment[]): void {
    for (const c of cs) if (!c.formatted) this.writeEolComment(c);
  }

  /** Ruff's `parenthesized`: `left`, `content` indented on its own lines if it breaks, `right`. */
  writeParenthesized(
    left: () => void,
    content: () => void,
    right: () => void,
    dangling: readonly Comment[] = [],
    hug = false,
  ): void {
    left();
    this.writeParenthesizedContent(content, dangling, hug);
    right();
  }

  /** What `parenthesized` puts between its brackets, for a DSL rule that prints the brackets itself. */
  writeParenthesizedContent(
    content: () => void,
    dangling: readonly Comment[] = [],
    hug = false,
  ): void {
    const level = this.level;
    this.at(PAREN, () => {
      const g = level.k === "expr" ? level.g : undefined;
      if (g !== undefined) sink.openFitsExpanded(g);
      if (dangling.length === 0 && hug) content();
      else {
        sink.open(sink.GROUP);
        this.writeDanglingOpenParen(dangling);
        sink.open(sink.INDENT);
        sink.sLine(sink.SOFT | sink.COLLAPSE);
        content();
        sink.close();
        sink.sLine(sink.SOFT | sink.COLLAPSE);
        sink.close();
      }
      if (g !== undefined) sink.close();
    });
  }

  /** Ruff's `optional_parentheses`: parentheses only when `content` must break, whose groups see them. */
  writeOptionalParentheses(anchor: number, content: () => void): void {
    const g = sink.open(sink.GROUP);
    this.writeParenthesesOf(g, anchor, () =>
      this.at({ k: "expr", g }, content),
    );
    sink.close();
  }

  /** Ruff's `parenthesize_if_expands`. */
  writeParenthesizeIfExpands(
    anchor: number,
    content: () => void,
    indented = true,
  ): void {
    const g = sink.open(sink.GROUP);
    if (indented) this.writeParenthesesOf(g, anchor, () => this.at(PAREN, content));
    else {
      writeIfBroken(g, () => sink.sToken(anchor, "(", true));
      this.at(PAREN, content);
      writeIfBroken(g, () => sink.sToken(anchor, ")", true));
    }
    sink.close();
  }

  /** Synthetic parentheses around `content`, on lines of its own, while the group `g` breaks. */
  private writeParenthesesOf(g: number, anchor: number, content: () => void): void {
    writeIfBroken(g, () => sink.sToken(anchor, "(", true));
    sink.openIndentIfBreak(g);
    sink.sLine(sink.SOFT | sink.COLLAPSE);
    content();
    sink.close();
    sink.sLine(sink.SOFT | sink.COLLAPSE);
    writeIfBroken(g, () => sink.sToken(anchor, ")", true));
  }

  /** Ruff's `empty_parenthesized`: with no own-line comment, `soft_block_indent` of nothing prints nothing, so `()` never breaks. */
  writeEmptyParenthesized(
    left: () => void,
    dangling: readonly Comment[],
    right: () => void,
  ): void {
    const split = dangling.findIndex((c) => c.line === "own");
    const eol = split < 0 ? dangling : dangling.slice(0, split);
    const own = split < 0 ? [] : dangling.slice(split);
    sink.open(sink.GROUP);
    left();
    this.writeTrailing(eol);
    if (eol.length > 0) sink.sLine(sink.HARD | sink.COLLAPSE);
    if (own.length > 0) {
      sink.open(sink.INDENT);
      sink.sLine(sink.SOFT | sink.COLLAPSE);
      this.writeDangling(own);
      sink.close();
      sink.sLine(sink.SOFT | sink.COLLAPSE);
    }
    right();
    sink.close();
  }

  writeSoftLine(): void {
    const l = this.level;
    if (l.k === "paren") sink.sLine(sink.SOFT | sink.COLLAPSE);
    else if (l.k === "expr" && l.g !== undefined)
      writeIfBroken(l.g, () => sink.sLine(sink.SOFT | sink.COLLAPSE));
  }

  writeSoftLineOrSpace(): void {
    const l = this.level;
    if (l.k === "paren") sink.sLine(sink.COLLAPSE);
    else if (l.k === "expr" && l.g !== undefined) {
      const g = l.g;
      sink.open(sink.IF_BROKEN, g);
      sink.sLine(sink.COLLAPSE);
      sink.close();
      sink.open(sink.IF_FLAT, g);
      sink.sText(" ");
      sink.close();
    } else sink.sText(" ");
  }

  writeInParensGroup(content: () => void): void {
    const l = this.level;
    if (l.k === "paren") {
      sink.open(sink.GROUP);
      content();
      sink.close();
    } else if (l.k === "expr" && l.g !== undefined) {
      sink.open(sink.GROUP_IF_BROKEN, l.g);
      content();
      sink.close();
    } else content();
  }

  writeInParensIfBreaks(content: () => void): void {
    const l = this.level;
    if (l.k === "paren") writeIfBroken(-1, content);
    else if (l.k === "expr" && l.g !== undefined) writeIfBroken(l.g, content);
  }

  /** Whether the source has a comma (ruff's magic trailing comma) after `end`, before `sequenceEnd`. */
  magicTrailingComma(end: number, sequenceEnd: number): boolean {
    if (this.options["skip-magic-trailing-comma"]) return false;
    for (const t of tokens(this.tree, end, sequenceEnd)) {
      if (t.kind === ")") continue;
      return t.kind === ",";
    }
    return false;
  }

  /**
   * Ruff's `join_comma_separated`: entries separated by a comma and a line, and a trailing comma when broken.
   * `commas` finds the source comma after an entry, so the self-check sees the input's own commas.
   */
  writeJoinCommaSeparated(
    entries: readonly { end: number; write: () => void; sep?: () => void }[],
    sequenceEnd: number,
    comma: (after: number) => void,
    oneOrMore = false,
  ): void {
    for (const [i, e] of entries.entries()) {
      if (i > 0) {
        const prev = entries[i - 1] as { end: number };
        comma(prev.end);
        if (e.sep) e.sep();
        else sink.sLine(sink.COLLAPSE);
      }
      e.write();
    }
    const last = entries.at(-1);
    if (last) {
      const magic = this.magicTrailingComma(last.end, sequenceEnd);
      // Inside a single-line f-string interpolation, a trailing comma would be printed flat for nothing.
      const inFlatFString = this.fstr.k !== "outside" && !this.fstr.multiline;
      if ((magic || entries.length > 1 || oneOrMore) && !inFlatFString) {
        sink.open(sink.IF_BROKEN);
        comma(last.end);
        sink.close();
      }
      if (magic) sink.sBreakParent();
    }
  }
}

function writeIfBroken(g: number, content: () => void): void {
  sink.open(sink.IF_BROKEN, g);
  content();
  sink.close();
}

/** Writes the comma among `parent`'s children at or after position `from`, or a synthetic one after `anchor`. */
export function writeCommaIn(
  tree: FormatTree,
  parent: number,
  anchor: number,
): (from: number) => void {
  return (from) => {
    const c = commaAfter(tree, parent, from);
    if (c === undefined) sink.sToken(anchor, ",", true);
    else sink.sToken(c, ",");
  };
}

function commaAfter(tree: FormatTree, parent: number, from: number): number | undefined {
  for (let i = 0, n = tree.count(parent); i < n; i++) {
    const c = tree.child(parent, i);
    if (!tree.named(c) && tree.kindName(c) === "," && startOf(tree, c) >= from) return c;
  }
  return undefined;
}
