// The customs stmt-simple.ts's `.via`s name: a one-line statement's child as ruff lays it out there.
import type { Expr, Simple } from "../fmt/ast.js";
import { commaIn } from "../fmt/builders.js";
import { formatExpr, maybeParenthesize, node } from "../fmt/expr.js";
import { part, ruffOf, ruffStmtOf } from "../fmt/sink.js";
import { leftToRight } from "../fmt/stmt/assign.js";
import { globalNames } from "../fmt/stmt/simple.js";

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
  "simple.deleteTargets": (c: number) => {
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
