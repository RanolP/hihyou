// The customs stmt-simple.ts's `.via`s name: a one-line statement's child as ruff lays it out there.
import { type Expr, type Import, type ImportFrom, type Simple, Unformattable } from "../fmt/ast.js";
import { commaIn, space } from "../fmt/builders.js";
import { type Format, synthetic } from "../fmt/elements.js";
import { formatExpr, isSplittable, maybeParenthesize, needsParentheses, node } from "../fmt/expr.js";
import { part, ruffOf, ruffStmtOf } from "../fmt/sink.js";
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
import type { StmtRule, StmtRules } from "../fmt/stmt/suite.js";
import { byteOffsetOf } from "../fmt/trivia.js";

// Ruff's `is_arithmetic_like`: an expression statement it wraps in optional parentheses to break.
const arithmeticOps = new Set(["|", "^", "<<", ">>", "+", "-"]);

// An expression statement's four layouts, as ruff reads the statement.
const expressionStatement: StmtRules = {
  Expr(f, s) {
    const v = s.value;
    if (v.kind === "BinOp" && arithmeticOps.has(f.tree.kindName(v.op)))
      return maybeParenthesize(f, v, s, "optional");
    return formatExpr(f, v);
  },
  Assign(f, s) {
    const [first, ...rest] = s.targets;
    if (!first)
      throw new Unformattable(
        `assignment without target at ${byteOffsetOf(f.tree, s.ts)}`,
      );
    const eq = (i: number) => {
      const t = s.ops[i];
      if (t === undefined)
        throw new Unformattable(`missing = at ${byteOffsetOf(f.tree, s.ts)}`);
      return f.tok(t);
    };
    const last = rest.at(-1);
    if (last) {
      const out: Format[] = [targetWithEqual(f, first, eq(0), true)];
      for (const [i, t] of rest.slice(0, -1).entries())
        out.push(targetWithEqual(f, t, eq(i + 1), false));
      out.push(
        rightToLeft(
          f,
          () => beforeOperator(f, last),
          eq(rest.length),
          s.value,
          s,
        ),
      );
      return out;
    }
    if (hasTargetOwnParentheses(f, first) && first.parens.length === 0)
      return rightToLeft(f, () => beforeOperator(f, first), eq(0), s.value, s);
    return [targetWithEqual(f, first, eq(0), true), leftToRight(f, s.value, s)];
  },
  AnnAssign(f, s) {
    const cs = f.comments;
    const annotation = s.annotation;
    const needs = needsParentheses(f, annotation, s);
    const head: Format = [formatExpr(f, s.target), f.tok(s.colon), space];
    if (s.value && s.eq !== undefined) {
      if (needs !== "always" && isSplittable(annotation))
        return [
          head,
          rightToLeft(
            f,
            () => beforeOperator(f, annotation),
            f.tok(s.eq),
            s.value,
            s,
          ),
        ];
      const parens =
        cs.hasLeading(annotation) ||
        cs.hasTrailing(annotation) ||
        needs === "always"
          ? "always"
          : "never";
      return [
        head,
        formatExpr(f, annotation, parens),
        space,
        f.tok(s.eq),
        space,
        leftToRight(f, s.value, s),
      ];
    }
    if (needs === "always") return [head, formatExpr(f, annotation, "always")];
    return [head, leftToRight(f, annotation, s)];
  },
  AugAssign(f, s) {
    if (hasTargetOwnParentheses(f, s.target) && s.target.parens.length === 0)
      return rightToLeft(
        f,
        () => beforeOperator(f, s.target),
        f.tok(s.op),
        s.value,
        s,
      );
    return [
      formatExpr(f, s.target),
      space,
      f.tok(s.op),
      space,
      leftToRight(f, s.value, s),
    ];
  },
};

// A type alias after `type`, as ruff lays it out: its name, then its parameters, `=` and value.
const typeAlias: StmtRules = {
  TypeAlias(f, s) {
    const head: Format = formatExpr(f, s.name);
    const tp = s.typeParams;
    if (isInvalidTypeExpression(s.value))
      return [
        head,
        tp ? typeParams(f, tp) : [],
        space,
        f.tok(s.eq),
        space,
        formatExpr(f, s.value),
      ];
    if (tp)
      return [
        head,
        rightToLeft(f, () => typeParams(f, tp), f.tok(s.eq), s.value, s),
      ];
    return [head, space, f.tok(s.eq), space, leftToRight(f, s.value, s)];
  },
};

export const stmtSimpleVia = {
  // Given the statement's first child, prints the whole statement.
  "simple.expressionStatement": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    const rule = expressionStatement[s.kind] as StmtRule<typeof s.kind> | undefined;
    if (!rule) throw new Error(`python: an expression statement read as ${s.kind}`);
    part(rule(f, s as never));
  },
  "simple.typeAlias": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    part((typeAlias.TypeAlias as StmtRule<"TypeAlias">)(f, s as never));
  },
  "simple.returnValue": (c: number) => {
    const { f, e } = ruffOf(c);
    part(
      e.kind === "Tuple" && !f.comments.hasLeading(e)
        ? node(f, e, { tuple: "optionalParentheses" })
        : leftToRight(f, e, e.parent as Simple),
    );
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
    part(globalNames(f, s as Simple));
  },
  // Given the first alias, prints them all, commas and parentheses included.
  "simple.importNames": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    const { names, kw, ts } = s as Import;
    const comma = commaIn(f.tree, ts, kw);
    part(names.map((a, i) => (i === 0 ? alias(f, a) : [comma(names[i - 1]?.end ?? a.start), space, alias(f, a)])));
  },
  "simple.importFromNames": (c: number) => {
    const { f, s: st } = ruffStmtOf(c);
    const s = st as ImportFrom;
    const comma = commaIn(f.tree, s.ts, s.importKw);
    const entries = s.names.map((a) => ({ end: a.end, doc: alias(f, a) }));
    const list = () => f.joinCommaSeparated(entries, s.end, comma, true);
    const dangling = f.comments.dangling(s);
    if (dangling.length === 0) {
      part(f.parenthesizeIfExpands(s.importKw, list));
      return;
    }
    const open = s.open !== undefined ? f.tok(s.open) : synthetic(s.importKw, "(");
    const close = s.close !== undefined ? f.tok(s.close) : synthetic(s.importKw, ")");
    part(f.parenthesized(open, list, close, dangling));
  },
  // The dots and the names of `from a.b import`'s module, which ruff reads as tokens.
  "simple.importModule": (c: number) => {
    const { f, s } = ruffStmtOf(c);
    part((s as ImportFrom).module.map((t) => f.tok(t)));
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
