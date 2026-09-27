// The customs stmt-simple.ts's `.via`s name: a one-line statement's child as ruff lays it out there.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import {
  type AnnAssign,
  type Assign,
  type AugAssign,
  type Expr,
  type Import,
  type ImportFrom,
  type Simple,
  type TypeAlias,
  Unformattable,
} from "../fmt/ast.js";
import { commaIn, type Fmt } from "../fmt/builders.js";
import { formatExpr, isSplittable, maybeParenthesize, needsParentheses, node } from "../fmt/expr.js";
import { part, record, ruffOf, ruffStmtOf, sText, sToken } from "../fmt/sink.js";
import {
  beforeOperator,
  hasTargetOwnParentheses,
  isInvalidTypeExpression,
  leftToRight,
  rightToLeft,
  targetWithEqual,
  typeParams,
} from "../fmt/stmt/assign.js";
import { alias, globalNames } from "../fmt/stmt/simple.js";
import { byteOffsetOf } from "../fmt/trivia.js";

// Ruff's `is_arithmetic_like`: an expression statement it wraps in optional parentheses to break.
const arithmeticOps = new Set(["|", "^", "<<", ">>", "+", "-"]);

const space = () => sText(" ");

// An assignment statement's three layouts, as ruff reads the statement.
function assign(f: Fmt, s: Assign): void {
  const [first, ...rest] = s.targets;
  if (!first)
    throw new Unformattable(
      `assignment without target at ${byteOffsetOf(f.tree, s.ts)}`,
    );
  const eq = (i: number) => {
    const t = s.ops[i];
    if (t === undefined)
      throw new Unformattable(`missing = at ${byteOffsetOf(f.tree, s.ts)}`);
    return () => f.writeTok(t);
  };
  const last = rest.at(-1);
  if (last) {
    targetWithEqual(f, first, eq(0), true);
    for (const [i, t] of rest.slice(0, -1).entries())
      targetWithEqual(f, t, eq(i + 1), false);
    rightToLeft(f, () => beforeOperator(f, last), eq(rest.length), s.value, s);
  } else if (hasTargetOwnParentheses(f, first) && first.parens.length === 0)
    rightToLeft(f, () => beforeOperator(f, first), eq(0), s.value, s);
  else {
    targetWithEqual(f, first, eq(0), true);
    leftToRight(f, s.value, s);
  }
}

function annAssign(f: Fmt, s: AnnAssign): void {
  const cs = f.comments;
  const annotation = s.annotation;
  const needs = needsParentheses(f, annotation, s);
  part(formatExpr(f, s.target));
  f.writeTok(s.colon);
  space();
  const eqTok = s.eq;
  if (s.value && eqTok !== undefined) {
    if (needs !== "always" && isSplittable(annotation))
      return rightToLeft(
        f,
        () => beforeOperator(f, annotation),
        () => f.writeTok(eqTok),
        s.value,
        s,
      );
    const parens =
      cs.hasLeading(annotation) ||
      cs.hasTrailing(annotation) ||
      needs === "always"
        ? "always"
        : "never";
    part(formatExpr(f, annotation, parens));
    space();
    f.writeTok(eqTok);
    space();
    return leftToRight(f, s.value, s);
  }
  if (needs === "always") part(formatExpr(f, annotation, "always"));
  else leftToRight(f, annotation, s);
}

function augAssign(f: Fmt, s: AugAssign): void {
  if (hasTargetOwnParentheses(f, s.target) && s.target.parens.length === 0)
    return rightToLeft(
      f,
      () => beforeOperator(f, s.target),
      () => f.writeTok(s.op),
      s.value,
      s,
    );
  part(formatExpr(f, s.target));
  space();
  f.writeTok(s.op);
  space();
  leftToRight(f, s.value, s);
}

// A type alias after `type`, as ruff lays it out: its name, then its parameters, `=` and value.
function typeAlias(f: Fmt, s: TypeAlias): void {
  part(formatExpr(f, s.name));
  const tp = s.typeParams;
  if (isInvalidTypeExpression(s.value)) {
    if (tp) typeParams(f, tp);
    space();
    f.writeTok(s.eq);
    space();
    part(formatExpr(f, s.value));
  } else if (tp)
    rightToLeft(f, () => typeParams(f, tp), () => f.writeTok(s.eq), s.value, s);
  else {
    space();
    f.writeTok(s.eq);
    space();
    leftToRight(f, s.value, s);
  }
}

export const stmtSimpleVia = {
  // Given the statement's first child, prints the whole statement.
  "simple.expressionStatement": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, s } = ruffStmtOf(c);
    if (s.kind !== "Expr") {
      ctx.printNode(c);
      return;
    }
    const v = s.value;
    part(
      v.kind === "BinOp" && arithmeticOps.has(f.tree.kindName(v.op))
        ? maybeParenthesize(f, v, s, "optional")
        : formatExpr(f, v),
    );
  },
  // The whole statement: an assignment is its statement's only child.
  "simple.assignment": (n: number) => {
    const { f, s } = ruffStmtOf(n);
    if (s.kind === "Assign") assign(f, s);
    else if (s.kind === "AnnAssign") annAssign(f, s);
    else if (s.kind === "AugAssign") augAssign(f, s);
    else throw new Error(`python: an assignment read as ${s.kind}`);
  },
  "simple.typeAlias": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    if (s.kind !== "TypeAlias") throw new Error(`python: a type alias read as ${s.kind}`);
    typeAlias(f, s);
  },
  "simple.returnValue": (c: number) => {
    const { f, e } = ruffOf(c);
    if (e.kind === "Tuple" && !f.comments.hasLeading(e))
      part(node(f, e, { tuple: "optionalParentheses" }));
    else leftToRight(f, e, e.parent as Simple);
  },
  "simple.optional": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Simple, "optional"));
  },
  "simple.ifBreaks": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Simple, "ifBreaks"));
  },
  "simple.ifBreaksParenthesized": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Simple, "ifBreaksParenthesized"));
  },
  // Given the first name, prints them all: the layout is the statement's.
  "simple.globalNames": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    globalNames(f, s as Simple);
  },
  // Given the first alias, prints them all, commas and parentheses included.
  "simple.importNames": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    const { names, kw, ts } = s as Import;
    const comma = commaIn(f.tree, ts, kw);
    names.forEach((a, i) => {
      if (i > 0) {
        part(comma(names[i - 1]?.end ?? a.start));
        sText(" ");
      }
      alias(f, a);
    });
  },
  "simple.importFromNames": (c: number) => {
    const { f, s: st } = ruffStmtOf(c);
    const s = st as ImportFrom;
    const comma = commaIn(f.tree, s.ts, s.importKw);
    const entries = s.names.map((a) => ({ end: a.end, doc: record(() => alias(f, a)) }));
    const list = () => f.joinCommaSeparated(entries, s.end, comma, true);
    const dangling = f.comments.dangling(s);
    if (dangling.length === 0) {
      part(f.parenthesizeIfExpands(s.importKw, list));
      return;
    }
    // A parenthesis as written, or one added at `import`.
    const paren = (t: number | undefined, p: string) =>
      t !== undefined ? sToken(t, f.text(t)) : sToken(s.importKw, p, true);
    paren(s.open, "(");
    part(f.parenthesizedContent(list, dangling));
    paren(s.close, ")");
  },
  "simple.deleteTargets":(c: number) => {
    const { f, e } = ruffOf(c);
    const s = e.parent as Simple;
    // `del a, b` has several targets; `del (a, b)` has one, a tuple.
    const targets: Expr[] = e.kind === "Tuple" && e.open === undefined ? e.elts : [e];
    const [single] = targets;
    if (targets.length === 1 && single) {
      part(maybeParenthesize(f, single, s, "ifBreaks"));
      return;
    }
    const comma = commaIn(f.tree, e.ts, e.ts);
    const entries = targets.map((t) => ({ end: t.end, doc: formatExpr(f, t) }));
    part(f.parenthesizeIfExpands(s.kw, () => f.joinCommaSeparated(entries, s.end, comma)));
  },
};
