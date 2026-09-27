import type { Expr, Stmt, TypeParam, TypeParams } from "../ast.js";
import { Unformattable } from "../ast.js";
import { type Fmt, writeCommaIn } from "../builders.js";
import type { Comment } from "../comments.js";
import {
  canOmitOptionalParentheses,
  hasOwnParentheses,
  hasParentheses,
  needsParentheses,
  writeExpr,
  writeMaybeParenthesize,
  writeNode,
} from "../expr.js";
import {
  BROKEN,
  capture,
  close,
  closeBestFitParenthesize,
  closeVariant,
  COLLAPSE,
  GROUP,
  HARD,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  open,
  openBestFitParenthesize,
  openBestFitting,
  openVariant,
  type Part,
  place,
  removeSoftLines,
  SOFT,
  sLine,
  sText,
  sToken,
  willBreak,
} from "../sink.js";
import {
  implicitFlat,
  interpolatedAssignment,
  writeImplicitExpanded,
} from "../strings.js";
import * as sink from "../sink.js";
import type { Frame } from "../../../../fmt/dsl/runtime.js";
import { byteOffsetOf, startOf } from "../trivia.js";

/**
 * Ruff's assignments (statement/stmt_{assign,ann_assign,aug_assign,type_alias}.rs) and the layout of a
 * statement's last expression they share with `return` (`FormatStatementsLastExpression`): the value in
 * optional parentheses, with the end-of-line comments after it kept on its line, or, when the part before the
 * operator can split too, the first of several layouts that fits.
 */

const space = () => sText(" ");

/** A group built broken around what `content` writes. */
function brokenGroup(content: () => void): void {
  open(GROUP, -1, BROKEN);
  content();
  close();
}

/** Ruff's `soft_block_indent` (`hard`: `block_indent`). */
function blockIndent(content: () => void, hard = false): void {
  const line = () => sLine((hard ? HARD : SOFT) | COLLAPSE);
  open(INDENT);
  line();
  content();
  close();
  line();
}

/** Ruff's `best_fitting`: each variant as its writer writes it. */
function bestFitting(variants: readonly (() => void)[], allLines = false): void {
  const k = openBestFitting(allLines);
  for (const write of variants) {
    const v = openVariant(k);
    write();
    closeVariant(v);
  }
  close();
}

/** Ruff's `has_target_own_parentheses`. */
export function hasTargetOwnParentheses(f: Fmt, e: Expr): boolean {
  return e.kind === "Tuple" || hasOwnParentheses(f, e) !== undefined;
}

/** Ruff's `is_attribute_with_parenthesized_value`. */
function isAttributeWithParenthesizedValue(f: Fmt, e: Expr): boolean {
  switch (e.kind) {
    case "Attribute":
      return (
        hasParentheses(f, e.value) !== undefined ||
        isAttributeWithParenthesizedValue(f, e.value)
      );
    case "Subscript":
      return true;
    case "Call":
      return e.args.items.length > 0;
    default:
      return false;
  }
}

/** Ruff's `should_parenthesize_target`. */
function shouldParenthesizeTarget(f: Fmt, e: Expr): boolean {
  return !(
    hasTargetOwnParentheses(f, e) || isAttributeWithParenthesizedValue(f, e)
  );
}

/** Ruff's `FormatTargetWithEqualOperator`: a target and the `=` after it. */
export function targetWithEqual(
  f: Fmt,
  target: Expr,
  eq: () => void,
  preserveParentheses: boolean,
): void {
  const cs = f.comments;
  if (preserveParentheses || cs.hasLeading(target) || cs.hasTrailing(target))
    writeExpr(f, target);
  else if (shouldParenthesizeTarget(f, target))
    f.writeParenthesizeIfExpands(target.ts, () =>
      writeExpr(f, target, "never"),
    );
  else writeExpr(f, target, "never");
  space();
  eq();
  space();
}

/** Ruff's `AnyBeforeOperator::Expression`. */
export function beforeOperator(f: Fmt, e: Expr): void {
  const cs = f.comments;
  if (cs.hasLeading(e) || cs.hasTrailing(e)) return writeExpr(f, e);
  if (!shouldParenthesizeTarget(f, e)) return writeExpr(f, e, "never");
  const content = () => writeExpr(f, e, "never");
  if (canOmitOptionalParentheses(f, e)) f.writeOptionalParentheses(e.ts, content);
  else f.writeParenthesizeIfExpands(e.ts, content);
}

/** Ruff's `should_inline_comments`: a value whose end-of-line comments stay after it when it is parenthesized. */
function shouldInlineComments(f: Fmt, value: Expr, stmt: Stmt): boolean {
  switch (value.kind) {
    case "Name":
    case "None":
    case "Number":
    case "Bool":
      return true;
    case "Str":
      return needsParentheses(f, value, stmt) === "bestFit";
    default:
      return false;
  }
}

/** Ruff's `should_non_inlineable_use_best_fit`. */
function nonInlineableUsesBestFit(f: Fmt, value: Expr, stmt: Stmt): boolean {
  return (
    (value.kind === "Attribute" ||
      value.kind === "Call" ||
      value.kind === "Subscript") &&
    needsParentheses(f, value, stmt) === "bestFit"
  );
}

/** Ruff's `MaybeParenthesizeValue`. */
function maybeParenthesizeValue(f: Fmt, value: Expr, stmt: Stmt): void {
  if (value.kind === "Lambda" && !f.comments.hasLeading(value))
    f.writeParenthesizeIfExpands(value.ts, () =>
      writeNode(f, value, { lambdaAssign: true }),
    );
  else writeMaybeParenthesize(f, value, stmt, "ifBreaks");
}

/**
 * Ruff's `OptionalParenthesesInlinedComments`: the value's end-of-line comments and the statement's first
 * run of them, printed after the value; undefined when the value has a comment that needs its own line.
 */
function inlinedComments(
  f: Fmt,
  value: Expr,
  stmt: Stmt,
): Comment[] | undefined {
  const cs = f.comments;
  if (cs.hasLeading(value) || cs.hasTrailingOwnLine(value)) return undefined;
  const statement = cs.trailing(stmt);
  const run = statement.findIndex((c) => c.line !== "eol");
  return [
    ...cs.trailing(value),
    ...(run < 0 ? statement : statement.slice(0, run)),
  ];
}

/** Prints `comments` once, marking them printed so the value and the statement leave them out. */
function inlinePart(f: Fmt, comments: readonly Comment[]): Part {
  return capture(() => f.writeTrailing(comments));
}

const unmark = (comments: readonly Comment[]) => {
  for (const c of comments) c.formatted = false;
};

const lparen = (e: Expr) => sToken(e.ts, "(", true);
const rparen = (e: Expr) => sToken(e.ts, ")", true);
const isInterpolatedStr = (e: Expr) =>
  e.kind === "Str" && (e.flavor === "f" || e.flavor === "t");

/** Ruff's `FormatStatementsLastExpression::LeftToRight`: `value` after its statement's operator. */
export function leftToRight(f: Fmt, value: Expr, stmt: Stmt): void {
  const str = value.kind === "Str" ? value : undefined;
  const canInline = shouldInlineComments(f, value, stmt);
  const interpolated = str && interpolatedAssignment(f, str);
  const implicit = str && implicitFlat(f, str);
  if (!canInline && !implicit && !interpolated)
    return maybeParenthesizeValue(f, value, stmt);

  const comments = inlinedComments(f, value, stmt);
  if (!comments) return writeExpr(f, value, "always");
  const inline = inlinePart(f, comments);
  const fallback = () => {
    unmark(comments);
    writeMaybeParenthesize(f, value, stmt, "ifBreaks");
  };
  const flatThenInline = (flat: Part) => () => {
    place(flat);
    place(inline);
  };
  const parenthesizedFlat = (flat: Part) => () =>
    brokenGroup(() => {
      lparen(value);
      blockIndent(flatThenInline(flat));
      rparen(value);
    });

  if (str && implicit) {
    const raw = capture(implicit);
    const isInterpolated = isInterpolatedStr(str);
    const flat = isInterpolated ? removeSoftLines(raw) : raw;
    if (isInterpolated && willBreak(flat)) return fallback();
    return bestFitting(
      [
        flatThenInline(flat),
        parenthesizedFlat(flat),
        () => {
          const g = open(GROUP, -1, BROKEN);
          lparen(value);
          blockIndent(
            () =>
              f.at({ k: "expr", g }, () =>
                writeImplicitExpanded(f, str),
              ),
            true,
          );
          rparen(value);
          place(inline);
          close();
        },
      ],
      true,
    );
  }

  if (interpolated) {
    const raw = capture(interpolated);
    const flat = removeSoftLines(raw);
    if (willBreak(flat)) return fallback();
    return bestFitting(
      [flatThenInline(flat), parenthesizedFlat(flat), flatThenInline(raw)],
      true,
    );
  }

  const b = openBestFitParenthesize(() => lparen(value));
  f.at({ k: "expr", g: b }, () => writeExpr(f, value, "never"));
  if (comments.length === 0) return closeBestFitParenthesize(b, () => rparen(value));
  open(IF_BROKEN, b);
  place(inline);
  close();
  closeBestFitParenthesize(b, () => rparen(value));
  open(IF_FLAT, b);
  place(inline);
  close();
}

/**
 * Ruff's `FormatStatementsLastExpression::RightToLeft`: `before` (the last target, or a type alias's
 * parameters), `op`, then `value`, splitting the value first and the target only when that is not enough.
 */
export function rightToLeft(
  f: Fmt,
  before: () => void,
  op: () => void,
  value: Expr,
  stmt: Stmt,
): void {
  const str = value.kind === "Str" ? value : undefined;
  const canInline = shouldInlineComments(f, value, stmt);
  const interpolated = str && interpolatedAssignment(f, str);
  const implicit = str && implicitFlat(f, str);
  const withOp = () => {
    space();
    op();
    space();
  };
  if (
    !canInline &&
    !nonInlineableUsesBestFit(f, value, stmt) &&
    !implicit &&
    !interpolated
  ) {
    before();
    withOp();
    return maybeParenthesizeValue(f, value, stmt);
  }

  const cs = f.comments;
  let comments: Comment[] | undefined;
  if (canInline || implicit || interpolated)
    comments = inlinedComments(f, value, stmt);
  else if (!cs.hasLeading(value) && !cs.hasTrailingOwnLine(value))
    comments = [];
  if (!comments) {
    before();
    withOp();
    return writeExpr(f, value, "always");
  }
  const inline = inlinePart(f, comments);
  const last = capture(before);
  const lastBreaks = willBreak(last);
  const fallback = (marked: readonly Comment[]) => {
    unmark(marked);
    place(last);
    withOp();
    writeMaybeParenthesize(f, value, stmt, "ifBreaks");
  };

  if (!implicit && !interpolated && lastBreaks) {
    place(last);
    withOp();
    writeExpr(f, value, "never");
    return place(inline);
  }

  // The interpolated string as it prints with its line breaks, which the flat layouts leave out.
  const interpolatedRaw = interpolated ? capture(interpolated) : undefined;
  let formatValue: Part;
  if (str && implicit) {
    const raw = capture(implicit);
    formatValue = isInterpolatedStr(str) ? removeSoftLines(raw) : raw;
  } else if (interpolatedRaw !== undefined)
    formatValue = removeSoftLines(interpolatedRaw);
  else formatValue = capture(() => writeExpr(f, value, "never"));

  const splitLast = () => brokenGroup(() => place(last));
  const valueParenthesizedFlat = () => {
    lparen(value);
    brokenGroup(() =>
      blockIndent(() => {
        place(formatValue);
        place(inline);
      }),
    );
    rparen(value);
  };
  const singleLine = () => {
    place(last);
    withOp();
    place(formatValue);
    place(inline);
  };
  const flatTargetParenthesizeValue = () => {
    place(last);
    withOp();
    valueParenthesizedFlat();
  };
  const splitTargetFlatValue = () => {
    splitLast();
    withOp();
    place(formatValue);
    place(inline);
  };

  if (
    value.kind === "Call" ||
    value.kind === "Subscript" ||
    value.kind === "Attribute"
  )
    return bestFitting([
      singleLine,
      () => {
        place(last);
        withOp();
        brokenGroup(() => place(formatValue));
      },
      flatTargetParenthesizeValue,
      splitTargetFlatValue,
    ]);

  const splitTargetValueParenthesizedFlat = () => {
    splitLast();
    withOp();
    valueParenthesizedFlat();
  };

  if (str && implicit) {
    if (isInterpolatedStr(str) && willBreak(formatValue))
      return fallback(comments);
    const expanded = capture(() => {
      const g = open(GROUP, -1, BROKEN);
      blockIndent(() =>
        f.at({ k: "expr", g }, () =>
          writeImplicitExpanded(f, str),
        ),
      );
      close();
    });
    const valueExpanded = () => {
      withOp();
      lparen(value);
      place(expanded);
      rparen(value);
      place(inline);
    };
    const splitTargetValueParenthesizedMultiline = () => {
      splitLast();
      valueExpanded();
    };
    if (lastBreaks)
      return bestFitting(
        [
          splitTargetFlatValue,
          splitTargetValueParenthesizedFlat,
          splitTargetValueParenthesizedMultiline,
        ],
        true,
      );
    return bestFitting(
      [
        singleLine,
        flatTargetParenthesizeValue,
        () => {
          place(last);
          valueExpanded();
        },
        splitTargetFlatValue,
        splitTargetValueParenthesizedFlat,
        splitTargetValueParenthesizedMultiline,
      ],
      true,
    );
  }

  if (interpolatedRaw !== undefined) {
    if (willBreak(formatValue)) return fallback(comments);
    const regular = () => {
      withOp();
      place(interpolatedRaw);
      place(inline);
    };
    const splitTargetRegular = () => {
      splitLast();
      regular();
    };
    if (lastBreaks)
      return bestFitting(
        [
          splitTargetFlatValue,
          splitTargetValueParenthesizedFlat,
          splitTargetRegular,
        ],
        true,
      );
    return bestFitting(
      [
        singleLine,
        flatTargetParenthesizeValue,
        () => {
          place(last);
          regular();
        },
        splitTargetFlatValue,
        splitTargetValueParenthesizedFlat,
        splitTargetRegular,
      ],
      true,
    );
  }

  bestFitting([singleLine, flatTargetParenthesizeValue, splitTargetFlatValue]);
}

/** Ruff's `FormatTypeVar` / `FormatTypeVarTuple` / `FormatParamSpec`. */
function writeTypeParam(f: Fmt, p: TypeParam): void {
  if (p.colon !== undefined && p.bound) sink.sDsl(p.ts);
  else {
    if (p.star !== undefined) sink.sToken(p.star, f.text(p.star));
    sink.sToken(p.name, f.text(p.name));
  }
}

/** A type alias's type parameters, as their rule prints them. */
export const typeParams = (_: Fmt, tp: TypeParams): void => sink.sDsl(tp.ts);

/** Ruff's `FormatTypeParams`: `[T, *Ts, **P]`, split one per line when it does not fit, in `frame`'s brackets. */
export function writeAliasTypeParams(f: Fmt, tp: TypeParams, frame: Frame): void {
  if (f.comments.hasAnyIn(tp.start, tp.end))
    throw new Unformattable(
      `comment in type parameters at ${byteOffsetOf(f.tree, tp.ts)}`,
    );
  const entries = tp.params.map((p) => ({ end: p.end, write: () => writeTypeParam(f, p) }));
  f.writeParenthesized(
    frame.open,
    () => f.writeJoinCommaSeparated(entries, startOf(f.tree, tp.close), writeCommaIn(f.tree, tp.ts, tp.open)),
    frame.close,
  );
}

/** Ruff's `is_invalid_type_expression`: a type alias value only kept as written. */
export const isInvalidTypeExpression = (e: Expr) =>
  e.kind === "Named" || e.kind === "Await" || e.kind === "Yield";
