import {
  breakParent,
  type Doc,
  fitsExpanded,
  type GroupRef,
  group,
  groupIfBreak,
  ifBreak,
  indent,
  indentIfBreak,
  COLLAPSE,
  HARD,
  lineOf,
  lineSuffix,
  BLANK,
  SOFT,
  synthetic,
  type Token,
  text,
  textOf,
  token,
} from "../../../fmt/doc.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { textWidth } from "../../../fmt/width.js";
import type { Comment, Comments } from "./comments.js";
import { isPragma, normalizeComment } from "./comments.js";
import type { FState } from "./strings.js";
import { linesAfter, linesBefore, tokens } from "./trivia.js";

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
 * becomes and how many blank lines a comment keeps. `g` is the group of the optional parentheses around.
 */
export type Level =
  | { readonly k: "top" }
  | { readonly k: "compound" }
  | { readonly k: "expr"; readonly g: GroupRef | undefined }
  | { readonly k: "paren" };

export const TOP: Level = { k: "top" };
export const COMPOUND: Level = { k: "compound" };
export const PAREN: Level = { k: "paren" };
export const EXPR: Level = { k: "expr", g: undefined };

// Ruff's lines: breaking on a line that is still empty prints nothing, so they never stack into blank lines.
export const hard = lineOf(HARD | COLLAPSE);
export const soft = lineOf(SOFT | COLLAPSE);
export const softOrSpace = lineOf(COLLAPSE);
export const emptyLine = lineOf(HARD | COLLAPSE | BLANK);
export const space = text(" ");

export const blockIndent = (d: Doc): Doc => [indent([hard, d]), hard];
export const softBlockIndent = (d: Doc): Doc => [indent([soft, d]), soft];

/** The state one formatting run threads through the rules. */
export class Fmt {
  level: Level = TOP;
  /** How many suites deep the statement being printed is: the indentation a docstring's lines take. */
  depth = 0;
  /** Whether an f-string's interpolation is being printed, and that string's quotes. */
  fstr: FState = { k: "outside" };

  constructor(
    readonly src: string,
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

  text(n: { start: number; end: number }): string {
    return this.src.slice(n.start, n.end);
  }

  tok(n: FormatNode, as?: string): Token {
    return token(n, as ?? this.src.slice(n.start, n.end));
  }

  /** A comment as printed; marks it printed. */
  comment(c: Comment): Token {
    c.formatted = true;
    return token(c.ts, normalizeComment(this.src.slice(c.start, c.end)));
  }

  emptyLines(n: number): Doc {
    switch (this.level.k) {
      case "top":
        return n <= 1 ? hard : n === 2 ? emptyLine : [emptyLine, emptyLine];
      case "compound":
        return n <= 1 ? hard : emptyLine;
      default:
        return hard;
    }
  }

  leading(cs: readonly Comment[]): Doc {
    const out: Doc[] = [];
    for (const c of cs) {
      if (c.formatted) continue;
      out.push(this.comment(c), this.emptyLines(linesAfter(c.end, this.src)));
    }
    return out;
  }

  trailing(cs: readonly Comment[]): Doc {
    const out: Doc[] = [];
    let ownLine = false;
    for (const c of cs) {
      if (c.formatted) continue;
      ownLine ||= c.line === "own";
      if (ownLine) {
        const lines = this.emptyLines(linesBefore(c.start, this.src));
        out.push(suffix([lines, this.comment(c)], 0), breakParent);
      } else out.push(this.eolComment(c));
    }
    return out;
  }

  eolComment(c: Comment): Doc {
    const t = this.comment(c);
    const reserved = isPragma(textOf(t)) ? 0 : 2 + textWidth(textOf(t));
    return [suffix([text("  "), t], reserved), breakParent];
  }

  dangling(cs: readonly Comment[]): Doc {
    const out: Doc[] = [];
    let first = true;
    for (const c of cs) {
      if (c.formatted) continue;
      if (first) out.push(c.line === "own" ? hard : text("  "));
      out.push(this.comment(c), this.emptyLines(linesAfter(c.end, this.src)));
      first = false;
    }
    return out;
  }

  danglingOpenParen(cs: readonly Comment[]): Doc {
    return cs.filter((c) => !c.formatted).map((c) => this.eolComment(c));
  }

  /** Ruff's `parenthesized`: `left`, `content` indented on its own lines if it breaks, `right`. */
  parenthesized(
    left: Token,
    content: () => Doc,
    right: Token,
    dangling: readonly Comment[] = [],
    hug = false,
  ): Doc {
    const level = this.level;
    return this.at(PAREN, () => {
      const c = content();
      const indented =
        dangling.length === 0
          ? hug
            ? c
            : group(softBlockIndent(c))
          : group([this.danglingOpenParen(dangling), softBlockIndent(c)]);
      const inner =
        level.k === "expr" && level.g
          ? fitsExpanded(indented, level.g)
          : indented;
      return [left, inner, right];
    });
  }

  /** Ruff's `optional_parentheses`: parentheses only when `content` must break, whose groups see them. */
  optionalParentheses(anchor: FormatNode, content: () => Doc): Doc {
    const contents: Doc[] = [];
    const g = group(contents);
    const c = this.at({ k: "expr", g }, content);
    contents.push(
      ifBreak(synthetic(anchor, "("), [], g),
      indentIfBreak([soft, c], g),
      soft,
      ifBreak(synthetic(anchor, ")"), [], g),
    );
    return g;
  }

  /** Ruff's `parenthesize_if_expands`. */
  parenthesizeIfExpands(
    anchor: FormatNode,
    content: () => Doc,
    indented = true,
  ): Group2 {
    const c = this.at(PAREN, content);
    const contents: Doc[] = [];
    const g = group(contents);
    if (indented)
      contents.push(
        ifBreak(synthetic(anchor, "("), [], g),
        indentIfBreak([soft, c], g),
        soft,
        ifBreak(synthetic(anchor, ")"), [], g),
      );
    else
      contents.push(
        ifBreak(synthetic(anchor, "("), [], g),
        c,
        ifBreak(synthetic(anchor, ")"), [], g),
      );
    return g;
  }

  /** Ruff's `empty_parenthesized`. */
  emptyParenthesized(
    left: Token,
    dangling: readonly Comment[],
    right: Token,
  ): Doc {
    const split = dangling.findIndex((c) => c.line === "own");
    const eol = split < 0 ? dangling : dangling.slice(0, split);
    const own = split < 0 ? [] : dangling.slice(split);
    return group([
      left,
      this.trailing(eol),
      eol.length > 0 && own.length > 0 ? hard : [],
      softBlockIndent(this.dangling(own)),
      right,
    ]);
  }

  softLine(): Doc {
    const l = this.level;
    if (l.k === "paren") return soft;
    if (l.k === "expr" && l.g) return ifBreak(soft, [], l.g);
    return [];
  }

  softLineOrSpace(): Doc {
    const l = this.level;
    if (l.k === "paren") return softOrSpace;
    if (l.k === "expr" && l.g)
      return [ifBreak(softOrSpace, [], l.g), ifBreak([], space, l.g)];
    return space;
  }

  inParensGroup(d: Doc): Doc {
    const l = this.level;
    if (l.k === "paren") return group(d);
    if (l.k === "expr" && l.g) return groupIfBreak(d, l.g);
    return d;
  }

  inParensIfBreaks(d: Doc): Doc {
    const l = this.level;
    if (l.k === "paren") return ifBreak(d);
    if (l.k === "expr" && l.g) return ifBreak(d, [], l.g);
    return [];
  }

  /** Whether the source has a comma (ruff's magic trailing comma) after `end`, before `sequenceEnd`. */
  magicTrailingComma(end: number, sequenceEnd: number): boolean {
    if (this.options["skip-magic-trailing-comma"]) return false;
    for (const t of tokens(this.src, end, sequenceEnd)) {
      if (t.kind === ")") continue;
      return t.kind === ",";
    }
    return false;
  }

  /**
   * Ruff's `join_comma_separated`: entries separated by a comma and a line, and a trailing comma when broken.
   * `commas` finds the source comma after an entry, so the self-check sees the input's own commas.
   */
  joinCommaSeparated(
    entries: readonly { end: number; doc: Doc; sep?: Doc }[],
    sequenceEnd: number,
    comma: (after: number) => Token,
    oneOrMore = false,
  ): Doc {
    const out: Doc[] = [];
    for (const [i, e] of entries.entries()) {
      if (i > 0) {
        const prev = entries[i - 1] as { end: number };
        out.push(comma(prev.end), e.sep ?? softOrSpace);
      }
      out.push(e.doc);
    }
    const last = entries.at(-1);
    if (last) {
      const magic = this.magicTrailingComma(last.end, sequenceEnd);
      // Inside a single-line f-string interpolation, a trailing comma would be printed flat for nothing.
      const inFlatFString = this.fstr.k !== "outside" && !this.fstr.multiline;
      if ((magic || entries.length > 1 || oneOrMore) && !inFlatFString)
        out.push(ifBreak(comma(last.end)));
      if (magic) out.push(breakParent);
    }
    return out;
  }
}

type Group2 = ReturnType<typeof group>;

export const suffix = (contents: Doc, reserved: number): Doc =>
  lineSuffix(contents, reserved);

/** The comma token in `parent` (a tree-sitter node) at or after `from`, or a synthetic one after `anchor`. */
export function commaIn(
  parent: FormatNode,
  anchor: FormatNode,
): (from: number) => Token {
  return (from) => {
    for (const c of parent.children)
      if (!c.named && c.kind === "," && c.start >= from) return token(c, ",");
    return synthetic(anchor, ",");
  };
}
