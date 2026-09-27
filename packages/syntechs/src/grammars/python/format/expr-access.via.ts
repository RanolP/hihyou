// The customs expr-access.ts's `.via`s name.
import type { Py } from "../fmt/ast.js";
import { formatExpr } from "../fmt/expr.js";
import { part, ruffOf } from "../fmt/sink.js";

export const exprAccessVia = {
  // The splat's dangling comments, between its star and its value, print with the value.
  "access.starredValue": (c: number) => {
    const { f, e } = ruffOf(c);
    part([f.dangling(f.comments.dangling(e.parent as Py)), formatExpr(f, e)]);
  },
};
