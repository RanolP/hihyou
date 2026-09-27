// The customs expr.ts's `.via`s name.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import { number } from "../fmt/expr.js";
import { sToken } from "../fmt/sink.js";

export const exprVia = {
  // A number read as ruff normalizes it; a pattern's number has no expression in the module's AST to look up.
  "expr.number": (c: number, ctx: StreamCtx<unknown>) => {
    sToken(c, number(ctx.tree.text(c)));
  },
};
