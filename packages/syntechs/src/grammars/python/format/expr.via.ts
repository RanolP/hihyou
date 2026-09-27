// The customs expr.ts's `.via`s name.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { BinOp, BoolOp, Compare, IfExp, Lambda, Named, Py, UnaryOp } from "../fmt/ast.js";
import { hard, space } from "../fmt/builders.js";
import { fitsExpanded, group } from "../fmt/elements.js";
import {
  binaryLike,
  formatExpr,
  lambdaBody,
  lambdaHeader,
  lambdaParams,
  maybeParenthesize,
  node,
  number,
  unaryNeedsLineBreak,
} from "../fmt/expr.js";
import { part, ruffOf, sText, sToken } from "../fmt/sink.js";

export const exprVia = {
  "expr.lambdaParams": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(c));
    const l = e as Lambda;
    if (l.params) part(lambdaParams(f, l, l.params));
  },
  // An assignment's lambda (`ctx.args.lambdaAssign`, from ruff's caller) fits its body expanded.
  "expr.lambdaBody": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(c));
    const l = e as Lambda;
    const header = lambdaHeader(f, l);
    const body = lambdaBody(f, l, header);
    part([header.length === 0 ? space : [], ctx.args?.lambdaAssign === true ? fitsExpanded(body) : body]);
  },
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
  "expr.ifBody": (c: number) => {
    const { f, e } = ruffOf(c);
    const x = e.parent as IfExp;
    part([formatExpr(f, e), f.softLineOrSpace(), f.leading(f.comments.leading(x.test))]);
  },
  "expr.ifTest": (c: number) => {
    const { f, e } = ruffOf(c);
    const x = e.parent as IfExp;
    part([formatExpr(f, e), f.softLineOrSpace(), f.leading(f.comments.leading(x.orelse))]);
  },
  "expr.ifOrelse": (c: number) => {
    const { f, e: orelse } = ruffOf(c);
    part(
      orelse.kind === "IfExp" && orelse.parens.length === 0
        ? node(f, orelse, { ifNested: true })
        : f.inParensGroup(formatExpr(f, orelse)),
    );
  },
  "expr.namedTarget": (c: number) => {
    const { f, e } = ruffOf(c);
    part(group([formatExpr(f, e), f.softLineOrSpace()]));
  },
  "expr.namedValue": (c: number) => {
    const { f, e } = ruffOf(c);
    const dangling = f.comments.dangling(e.parent as Named);
    part([dangling.length === 0 ? space : [f.dangling(dangling), hard], formatExpr(f, e)]);
  },
};
