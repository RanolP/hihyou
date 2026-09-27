// The customs expr.ts's `.via`s name.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { BinOp, BoolOp, Compare, Py, UnaryOp } from "../fmt/ast.js";
import { hard, space } from "../fmt/builders.js";
import { binaryLike, formatExpr, maybeParenthesize, number, unaryNeedsLineBreak } from "../fmt/expr.js";
import { part, ruffOf, sText, sToken } from "../fmt/sink.js";

export const exprVia = {
  // A number read as ruff normalizes it; a pattern's number has no expression in the module's AST to look up.
  "expr.number": (c: number, ctx: StreamCtx<unknown>) => {
    sToken(c, number(ctx.tree.text(c)));
  },
  // The operand with what goes between it and the operator: the operator's dangling comments and a space or break.
  "expr.unaryOperand": (c: number) => {
    const { f, e: operand } = ruffOf(c);
    const e = operand.parent as UnaryOp;
    const op = f.text(e.op);
    const lineBreak = unaryNeedsLineBreak(f, e);
    const parens: "always" | "preserve" =
      operand.kind === "BinOp" &&
      operand.parens.length === 0 &&
      f.text(operand.op) === "**"
        ? "always"
        : "preserve";
    part([
      f.trailing(f.comments.dangling(e)),
      lineBreak ? hard : op === "not" ? space : [],
      formatExpr(f, operand, parens),
    ]);
  },
  "expr.awaitValue": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Py, "ifBreaks"));
  },
  "expr.yieldFrom": (token: number | undefined, _: number, ctx: StreamCtx<unknown>) => {
    if (token === undefined) return;
    sText(" ");
    sToken(token, ctx.tree.text(token));
  },
  "expr.yieldValue": (c: number) => {
    const { f, e } = ruffOf(c);
    part(maybeParenthesize(f, e, e.parent as Py, "optional"));
  },
  "expr.binaryLike": (c: number) => {
    const { f, e } = ruffOf(c);
    part(binaryLike(f, e as BinOp | Compare | BoolOp));
  },
};
