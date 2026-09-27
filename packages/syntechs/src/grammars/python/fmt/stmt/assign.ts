import {
  bestFitParenthesize,
  bestFitting,
  type Format,
  group,
  ifBreak,
  removeSoftLines,
  synthetic,
  willBreak,
} from "../elements.js";
import type { Expr, Stmt, TypeParam, TypeParams } from "../ast.js";
import { Unformattable } from "../ast.js";
import {
  blockIndent,
  commaIn,
  type Fmt,
  softBlockIndent,
  space,
} from "../builders.js";
import type { Comment } from "../comments.js";
import {
  canOmitOptionalParentheses,
  formatExpr,
  hasOwnParentheses,
  hasParentheses,
  hooks,
  maybeParenthesize,
  needsParentheses,
  node,
} from "../expr.js";
import {
  implicitExpanded,
  implicitFlat,
  interpolatedAssignment,
} from "../strings.js";
import { dslPart } from "../sink.js";
import { byteOffsetOf, startOf } from "../trivia.js";
import type { StmtRules } from "./suite.js";

/**
 * Ruff's assignments (statement/stmt_{assign,ann_assign,aug_assign,type_alias}.rs) and the layout of a
 * statement's last expression they share with `return` (`FormatStatementsLastExpression`): the value in
 * optional parentheses, with the end-of-line comments after it kept on its line, or, when the part before the
 * operator can split too, the first of several layouts that fits.
 */

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
  eq: Format,
  preserveParentheses: boolean,
): Format {
  const cs = f.comments;
  let doc: Format;
  if (preserveParentheses || cs.hasLeading(target) || cs.hasTrailing(target))
    doc = formatExpr(f, target);
  else if (shouldParenthesizeTarget(f, target))
    doc = f.parenthesizeIfExpands(target.ts, () =>
      formatExpr(f, target, "never"),
    );
  else doc = formatExpr(f, target, "never");
  return [doc, space, eq, space];
}

/** Ruff's `AnyBeforeOperator::Expression`. */
export function beforeOperator(f: Fmt, e: Expr): Format {
  const cs = f.comments;
  if (cs.hasLeading(e) || cs.hasTrailing(e)) return formatExpr(f, e);
  if (!shouldParenthesizeTarget(f, e)) return formatExpr(f, e, "never");
  const content = () => formatExpr(f, e, "never");
  return canOmitOptionalParentheses(f, e)
    ? f.optionalParentheses(e.ts, content)
    : f.parenthesizeIfExpands(e.ts, content);
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
function maybeParenthesizeValue(f: Fmt, value: Expr, stmt: Stmt): Format {
  if (value.kind === "Lambda" && !f.comments.hasLeading(value))
    return f.parenthesizeIfExpands(value.ts, () =>
      node(f, value, { lambdaAssign: true }),
    );
  return maybeParenthesize(f, value, stmt, "ifBreaks");
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
function inlineDoc(f: Fmt, comments: readonly Comment[]): Format {
  return f.trailing(comments);
}

const unmark = (comments: readonly Comment[]) => {
  for (const c of comments) c.formatted = false;
};

const lparen = (e: Expr) => synthetic(e.ts, "(");
const rparen = (e: Expr) => synthetic(e.ts, ")");
const isInterpolatedStr = (e: Expr) =>
  e.kind === "Str" && (e.flavor === "f" || e.flavor === "t");

/** Ruff's `FormatStatementsLastExpression::LeftToRight`: `value` after its statement's operator. */
export function leftToRight(f: Fmt, value: Expr, stmt: Stmt): Format {
  const str = value.kind === "Str" ? value : undefined;
  const canInline = shouldInlineComments(f, value, stmt);
  const interpolated = str && interpolatedAssignment(f, str, hooks);
  const implicit = str && implicitFlat(f, str, hooks);
  if (!canInline && !implicit && !interpolated)
    return maybeParenthesizeValue(f, value, stmt);

  const comments = inlinedComments(f, value, stmt);
  if (!comments) return formatExpr(f, value, "always");
  const inline = inlineDoc(f, comments);
  const fallback = () => {
    unmark(comments);
    return maybeParenthesize(f, value, stmt, "ifBreaks");
  };

  if (str && implicit) {
    const raw = implicit();
    const isInterpolated = isInterpolatedStr(str);
    const flat = isInterpolated ? removeSoftLines(raw) : raw;
    if (isInterpolated && willBreak(flat)) return fallback();
    const joined = group(
      [lparen(value), softBlockIndent([flat, inline]), rparen(value)],
      true,
    );
    const expandedContents: Format[] = [];
    const expanded = group(expandedContents, true);
    expandedContents.push(
      lparen(value),
      blockIndent(
        f.at({ k: "expr", g: expanded }, () => implicitExpanded(f, str, hooks)),
      ),
      rparen(value),
      inline,
    );
    return bestFitting([[flat, inline], joined, expanded], true);
  }

  if (interpolated) {
    const raw = interpolated();
    const flat = removeSoftLines(raw);
    if (willBreak(flat)) return fallback();
    return bestFitting(
      [
        [flat, inline],
        group(
          [lparen(value), softBlockIndent([flat, inline]), rparen(value)],
          true,
        ),
        [raw, inline],
      ],
      true,
    );
  }

  const contents: Format[] = [];
  const b = bestFitParenthesize(lparen(value), contents, rparen(value));
  contents.push(f.at({ k: "expr", g: b }, () => formatExpr(f, value, "never")));
  if (comments.length === 0) return b;
  contents.push(ifBreak(inline, [], b));
  return [b, ifBreak([], inline, b)];
}

/**
 * Ruff's `FormatStatementsLastExpression::RightToLeft`: `before` (the last target, or a type alias's
 * parameters), `op`, then `value`, splitting the value first and the target only when that is not enough.
 */
export function rightToLeft(
  f: Fmt,
  before: () => Format,
  op: Format,
  value: Expr,
  stmt: Stmt,
): Format {
  const str = value.kind === "Str" ? value : undefined;
  const canInline = shouldInlineComments(f, value, stmt);
  const interpolated = str && interpolatedAssignment(f, str, hooks);
  const implicit = str && implicitFlat(f, str, hooks);
  if (
    !canInline &&
    !nonInlineableUsesBestFit(f, value, stmt) &&
    !implicit &&
    !interpolated
  )
    return [before(), space, op, space, maybeParenthesizeValue(f, value, stmt)];

  const cs = f.comments;
  let comments: Comment[] | undefined;
  if (canInline || implicit || interpolated)
    comments = inlinedComments(f, value, stmt);
  else if (!cs.hasLeading(value) && !cs.hasTrailingOwnLine(value))
    comments = [];
  if (!comments)
    return [before(), space, op, space, formatExpr(f, value, "always")];
  const inline = inlineDoc(f, comments);
  const last = before();
  const lastBreaks = willBreak(last);
  const fallback = (marked: readonly Comment[]) => {
    unmark(marked);
    return [
      last,
      space,
      op,
      space,
      maybeParenthesize(f, value, stmt, "ifBreaks"),
    ];
  };

  if (!implicit && !interpolated && lastBreaks)
    return [last, space, op, space, formatExpr(f, value, "never"), inline];

  // The interpolated string as it prints with its line breaks, which the flat layouts leave out.
  const interpolatedRaw = interpolated?.();
  let formatValue: Format;
  if (str && implicit) {
    const raw = implicit();
    formatValue = isInterpolatedStr(str) ? removeSoftLines(raw) : raw;
  } else if (interpolatedRaw !== undefined)
    formatValue = removeSoftLines(interpolatedRaw);
  else formatValue = formatExpr(f, value, "never");

  const singleLine: Format = [last, space, op, space, formatValue, inline];
  const flatTargetParenthesizeValue: Format = [
    last,
    space,
    op,
    space,
    lparen(value),
    group(softBlockIndent([formatValue, inline]), true),
    rparen(value),
  ];
  const splitTargetFlatValue: Format = [
    group(last, true),
    space,
    op,
    space,
    formatValue,
    inline,
  ];

  if (
    value.kind === "Call" ||
    value.kind === "Subscript" ||
    value.kind === "Attribute"
  )
    return bestFitting([
      singleLine,
      [last, space, op, space, group(formatValue, true)],
      flatTargetParenthesizeValue,
      splitTargetFlatValue,
    ]);

  const splitTargetValueParenthesizedFlat: Format = [
    group(last, true),
    space,
    op,
    space,
    lparen(value),
    group(softBlockIndent([formatValue, inline]), true),
    rparen(value),
  ];

  if (str && implicit) {
    if (isInterpolatedStr(str) && willBreak(formatValue))
      return fallback(comments);
    const expandedContents: Format[] = [];
    const expanded = group(expandedContents, true);
    expandedContents.push(
      softBlockIndent(
        f.at({ k: "expr", g: expanded }, () => implicitExpanded(f, str, hooks)),
      ),
    );
    const splitTargetValueParenthesizedMultiline: Format = [
      group(last, true),
      space,
      op,
      space,
      lparen(value),
      expanded,
      rparen(value),
      inline,
    ];
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
        [
          last,
          space,
          op,
          space,
          lparen(value),
          expanded,
          rparen(value),
          inline,
        ],
        splitTargetFlatValue,
        splitTargetValueParenthesizedFlat,
        splitTargetValueParenthesizedMultiline,
      ],
      true,
    );
  }

  if (interpolatedRaw !== undefined) {
    if (willBreak(formatValue)) return fallback(comments);
    const regular: Format = [interpolatedRaw, inline];
    const splitTargetRegular: Format = [
      group(last, true),
      space,
      op,
      space,
      regular,
    ];
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
        [last, space, op, space, regular],
        splitTargetFlatValue,
        splitTargetValueParenthesizedFlat,
        splitTargetRegular,
      ],
      true,
    );
  }

  return bestFitting([
    singleLine,
    flatTargetParenthesizeValue,
    splitTargetFlatValue,
  ]);
}

/** Ruff's `FormatTypeVar` / `FormatTypeVarTuple` / `FormatParamSpec`. */
function typeParam(f: Fmt, p: TypeParam): Format {
  const out: Format[] = [p.star !== undefined ? f.tok(p.star) : [], f.tok(p.name)];
  if (p.colon !== undefined && p.bound)
    out.push(f.tok(p.colon), space, formatExpr(f, p.bound));
  return out;
}

/** Ruff's `FormatTypeParams`: `[T, *Ts, **P]`, split one per line when it does not fit. */
export function typeParams(f: Fmt, tp: TypeParams): Format {
  if (f.comments.hasAnyIn(tp.start, tp.end))
    throw new Unformattable(
      `comment in type parameters at ${byteOffsetOf(f.tree, tp.ts)}`,
    );
  const comma = commaIn(f.tree, tp.ts, tp.open);
  const entries = tp.params.map((p) => ({ end: p.end, doc: typeParam(f, p) }));
  return f.parenthesized(
    f.tok(tp.open),
    () => f.joinCommaSeparated(entries, startOf(f.tree, tp.close), comma),
    f.tok(tp.close),
  );
}

/** Ruff's `is_invalid_type_expression`: a type alias value only kept as written. */
export const isInvalidTypeExpression = (e: Expr) =>
  e.kind === "Named" || e.kind === "Await" || e.kind === "Yield";

// Statements their rules in format/stmt-simple.ts print.
const fromSpec = (_: Fmt, s: { readonly ts: number }) => dslPart(s.ts);

export const assignRules: StmtRules = {
  Assign: fromSpec,
  AnnAssign: fromSpec,
  AugAssign: fromSpec,
  TypeAlias: fromSpec,
};
