// The customs expr-access.ts's `.via`s name.
import type { Py } from "../fmt/ast.js";
import { formatExpr } from "../fmt/expr.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import { part, ruffOf, sToken } from "../fmt/sink.js";

export const exprAccessVia = {
  // A leaf the spec prints on its own writes past the `dslPart` recording, so the name records here.
  "access.keywordName": (c: number, ctx: StreamCtx<unknown>) => {
    sToken(c, ctx.tree.text(c));
  },
  "access.keywordValue": (c: number) => {
    const { f, e } = ruffOf(c);
    part(formatExpr(f, e));
  },
  // The splat's dangling comments, between its star and its value, print with the value.
  "access.starredValue": (c: number) => {
    const { f, e } = ruffOf(c);
    part([f.dangling(f.comments.dangling(e.parent as Py)), formatExpr(f, e)]);
  },
};
