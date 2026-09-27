// The customs stmt-simple.ts's `.via`s name: a one-line statement's child as ruff lays it out there.
import type { Expr, Import, ImportFrom, Simple } from "../fmt/ast.js";
import { commaIn, space } from "../fmt/builders.js";
import { synthetic } from "../fmt/elements.js";
import { formatExpr, maybeParenthesize, node } from "../fmt/expr.js";
import { part, ruffOf, ruffStmtOf } from "../fmt/sink.js";
import { leftToRight } from "../fmt/stmt/assign.js";
import { alias, globalNames } from "../fmt/stmt/simple.js";

export const stmtSimpleVia = {
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
