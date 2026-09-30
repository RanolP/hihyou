import type { Frame } from "../../../../fmt/dsl/runtime.js";
import type { MatchCase } from "../ast.js";
import { type Fmt, writeCommaIn } from "../builders.js";
import { writeExpr, writeMaybeParenthesize } from "../expr.js";
import { type Pat, outerEnd } from "../pattern.js";
import { close, COLLAPSE, GROUP, HARD, open, sDsl, sLine, sText, sToken } from "../sink.js";
import { endOf, startOf } from "../trivia.js";

/** Ruff's match pattern printers (pattern/*.rs), which a `match` statement's cases hold. */

/** Parentheses the pattern has none of in the source, anchored to `anchor`. */
const syntheticParens = (anchor: number): Frame => ({
  open: () => sToken(anchor, "(", true),
  body: () => {},
  close: () => sToken(anchor, ")", true),
});

/**
 * Ruff's `FormatPattern` with its `Parentheses` option: the pattern's comments around its fields, an end-of-line
 * leading comment right after the opening parenthesis.
 */
export function pattern(
  f: Fmt,
  p: Pat,
  parens: "preserve" | "always" | "never" = "preserve",
): void {
  const cs = f.comments;
  const parenthesize =
    parens === "preserve" ? p.paren !== undefined : parens === "always";
  const node = () => {
    f.writeLeading(cs.leading(p));
    if (p.cp !== undefined) sDsl(p.cp);
    else patternFields(f, p);
    f.writeTrailing(cs.trailing(p));
  };
  if (!parenthesize) return node();
  const [first] = cs.leading(p);
  const openComment = first?.line === "eol" ? [first] : [];
  const own = p.paren;
  if (!own) {
    const { open, close } = syntheticParens(p.node);
    return f.writeParenthesized(open, node, close, openComment);
  }
  f.writeParenthesized(
    () => sToken(own.open, f.text(own.open)),
    node,
    () => sToken(own.close, f.text(own.close)),
    openComment,
  );
}

/** What ruff's rule of the pattern's kind prints between its comments. */
export function patternFields(f: Fmt, p: Pat): void {
  const cs = f.comments;
  switch (p.k) {
    case "expr":
      return writeExpr(f, p.e, "never");
    case "neg":
      sToken(p.minus, f.text(p.minus));
      return writeExpr(f, p.e, "never");
    case "complex":
    case "or":
      return f.writeInParensGroup(() => sDsl(p.node));
    case "attr":
      for (const x of p.parts) sToken(x, f.text(x));
      return;
    case "wild":
      return sToken(p.node, f.text(p.node));
    case "seq":
      if (p.type === "bare") return sequence(f, p, syntheticParens(p.node));
      return sDsl(p.node);
    case "star":
      // Ruff's `FormatPatternMatchStar`: every comment inside is dangling, printed after the `*`.
      sToken(p.star, f.text(p.star));
      f.writeDangling(cs.dangling(p));
      return sToken(p.name, f.text(p.name));
    case "as": {
      // Ruff's `FormatPatternMatchAs`: a line after the pattern's trailing comments, the `as`'s after it.
      pattern(f, p.pattern);
      if (cs.hasTrailing(p.pattern)) sLine(HARD | COLLAPSE);
      else sText(" ");
      sToken(p.as, f.text(p.as));
      const dangling = cs.dangling(p);
      if (dangling.length === 0) sText(" ");
      else if (dangling.every((c) => c.line === "own")) sLine(HARD | COLLAPSE);
      f.writeDangling(dangling);
      return sToken(p.name, f.text(p.name));
    }
    case "map":
    case "class":
      return sDsl(p.node);
  }
}

/** Ruff's `FormatPatternMatchOr`: a line before each `|`, forced by the next alternative's leading comments. */
export function orPattern(f: Fmt, p: Pat & { k: "or" }): void {
  for (const [i, item] of p.items.entries()) {
    const bar = p.bars[i - 1];
    if (bar !== undefined) {
      const leading = f.comments.leading(item);
      if (leading.length === 0) f.writeSoftLineOrSpace();
      else {
        sLine(HARD | COLLAPSE);
        f.writeLeading(leading);
      }
      sToken(bar, f.text(bar));
      sText(" ");
    }
    pattern(f, item);
  }
}

/** Ruff's `FormatPatternMatchSequence` in `frame`, synthetic for a tuple without parentheses. */
export function sequence(f: Fmt, p: Pat & { k: "seq" }, frame: Frame): void {
  const [only] = p.items;
  const comma = writeCommaIn(
    f.tree,
    p.commas,
    p.open !== undefined ? p.open : p.node,
  );
  const dangling = f.comments.dangling(p);
  if (!only) return f.writeEmptyParenthesized(frame.open, dangling, frame.close);
  if (p.items.length === 1 && p.type !== "list")
    // A one-element tuple keeps its parentheses, and its comma never makes it expand.
    return f.writeParenthesized(
      frame.open,
      () => {
        pattern(f, only);
        comma(outerEnd(f.tree, only));
      },
      frame.close,
      dangling,
    );
  const items = () =>
    f.writeJoinCommaSeparated(
      p.items.map((x) => ({ end: outerEnd(f.tree, x), write: () => pattern(f, x) })),
      p.end_,
      comma,
    );
  if (p.type === "bare") return f.writeOptionalParentheses(p.node, items);
  f.writeParenthesized(frame.open, items, frame.close, dangling);
}

/**
 * Ruff's `FormatPatternMatchMapping` in its braces' `frame`. Its dangling comments are three kinds: end-of-line
 * ones before the `**` follow the `{`, the others before the rest's name lead the `**`, and those past it trail
 * the entries.
 */
export function mapping(f: Fmt, p: Pat & { k: "map" }, frame: Frame): void {
  const dangling = f.comments.dangling(p);
  const rest = p.rest;
  const star = rest ? startOf(f.tree, rest.star) : Number.POSITIVE_INFINITY;
  const name = rest ? startOf(f.tree, rest.name) : Number.POSITIVE_INFINITY;
  const openComments = dangling.filter((c) => c.line === "eol" && c.start < star);
  const starComments = dangling.filter((c) => !openComments.includes(c) && c.start < name);
  const afterRest = dangling.filter((c) => c.start >= name);
  if (p.pairs.length === 0 && !rest)
    return f.writeEmptyParenthesized(frame.open, dangling, frame.close);
  const entries = p.pairs.map(({ key, colon, value }) => ({
    end: outerEnd(f.tree, value),
    write: () => {
      open(GROUP);
      pattern(f, key);
      sToken(colon, f.text(colon));
      sText(" ");
      pattern(f, value);
      close();
    },
  }));
  if (rest)
    entries.push({
      end: endOf(f.tree, rest.name),
      write: () => {
        f.writeLeading(starComments);
        sToken(rest.star, f.text(rest.star));
        sToken(rest.name, f.text(rest.name));
      },
    });
  f.writeParenthesized(
    frame.open,
    () => {
      f.writeJoinCommaSeparated(entries, p.end, writeCommaIn(f.tree, p.node, p.open));
      f.writeTrailing(afterRest);
    },
    frame.close,
    openComments,
  );
}

/**
 * Ruff's `FormatPatternArguments`: a class pattern's parentheses' `frame` and what they hold, after the class
 * pattern's dangling comments, which sit between the class and its `(`.
 */
export function classArguments(
  f: Fmt,
  p: Pat & { k: "class" },
  frame: Frame,
): void {
  const cs = f.comments;
  const args = p.args;
  f.writeDangling(cs.dangling(p));
  const [only] = args.items;
  const dangling = cs.dangling(args);
  if (!only && args.keywords.length === 0)
    return f.writeEmptyParenthesized(frame.open, dangling, frame.close);
  const comma = writeCommaIn(f.tree, p.node, args.open);
  const entries =
    only && args.items.length === 1 && args.keywords.length === 0
      ? [
          {
            end: outerEnd(f.tree, only),
            // A lone argument keeps its parentheses only when it has its own.
            write: () => pattern(f, only, only.paren ? "always" : "never"),
          },
        ]
      : [
          ...args.items.map((x) => ({
            end: outerEnd(f.tree, x),
            write: () => pattern(f, x),
          })),
          ...args.keywords.map((k) => ({
            end: k.end,
            write: () => {
              f.writeLeading(cs.leading(k));
              sDsl(k.ts);
              if (k.alias !== undefined) {
                sText(" ");
                sToken(k.alias.as, f.text(k.alias.as));
                sText(" ");
                sToken(k.alias.name, f.text(k.alias.name));
              }
              f.writeTrailing(cs.trailing(k));
            },
          })),
        ];
  f.writeParenthesized(
    frame.open,
    () => {
      open(GROUP);
      f.writeJoinCommaSeparated(entries, args.end, comma);
      close();
    },
    frame.close,
    dangling,
  );
}

/** Ruff's `maybe_parenthesize_pattern`: a case's pattern, parenthesized by its kind and comments. */
export function maybeParenthesizePattern(f: Fmt, p: Pat, c: MatchCase): void {
  const cs = f.comments;
  // Comments before the pattern or on their own lines after it keep it parenthesized.
  if (cs.hasLeading(p) || cs.hasTrailingOwnLine(p)) return pattern(f, p, "always");
  const multiline = () => {
    const content = () => pattern(f, p, "never");
    return canPatternOmitOptionalParentheses(p)
      ? f.writeOptionalParentheses(p.node, content)
      : f.writeParenthesizeIfExpands(p.node, content);
  };
  switch (p.k) {
    case "expr":
      // A capture is ruff's `Multiline`, parenthesized once it breaks even if it still overflows; a value is `BestFit`.
      if (p.capture)
        return f.writeParenthesizeIfExpands(p.node, () => pattern(f, p, "never"));
      if (cs.hasTrailing(p)) return pattern(f, p, "always");
      return writeMaybeParenthesize(f, p.e, c, "ifBreaks");
    case "wild":
      return pattern(f, p, cs.hasTrailing(p) ? "always" : "never");
    case "or":
    case "as":
    case "complex":
      return multiline();
    case "class":
      return cs.hasDangling(p) ? multiline() : pattern(f, p, "never");
    default:
      return pattern(f, p, "never");
  }
}

/** Ruff's `can_pattern_omit_optional_parentheses`: split a first or last bracketed pattern before the `|`s. */
function canPatternOmitOptionalParentheses(root: Pat): boolean {
  let anyParenthesized = false;
  let maxPrecedence = 0; // 0 none, 1 additive, 2 or
  let maxCount = 0;
  let last: Pat | undefined;
  let first: Pat | "token" | undefined;
  const update = (precedence: number, count: number) => {
    if (maxPrecedence < precedence) {
      maxPrecedence = precedence;
      maxCount = count;
    } else if (maxPrecedence === precedence) maxCount += count;
  };
  const visit = (p: Pat) => {
    switch (p.k) {
      case "seq":
      case "map":
        anyParenthesized = true;
        break;
      case "complex":
        update(1, 1);
        break;
      case "class":
        anyParenthesized = true;
        first ??= "token";
        break;
      case "as":
        visitSub(p.pattern);
        break;
      case "or":
        update(2, p.items.length - 1);
        for (const item of p.items) visitSub(item);
        break;
      default:
    }
  };
  const visitSub = (p: Pat) => {
    last = p;
    if (p.paren) anyParenthesized = true;
    else visit(p);
    first ??= p;
  };
  visit(root);
  if (!anyParenthesized || maxCount > 1) return false;
  const bracketed = (p: Pat): boolean => {
    const own =
      p.k === "as"
        ? bracketed(p.pattern)
        : p.k === "seq"
          ? p.items.length > 0
          : p.k === "map"
            ? p.pairs.length > 0 || p.rest !== undefined
            : p.k === "class"
              ? p.args.items.length > 0 || p.args.keywords.length > 0
              : false;
    return own || p.paren !== undefined;
  };
  return (
    (last !== undefined && bracketed(last)) ||
    (first !== undefined && first !== "token" && bracketed(first))
  );
}
