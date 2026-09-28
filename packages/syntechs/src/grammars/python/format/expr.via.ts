// The customs expr.ts's `.via`s name.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { BinOp, BoolOp, Compare, IfExp, Lambda, Named, Py, UnaryOp } from "../fmt/ast.js";
import {
  lambdaHeader,
  type Parenthesize,
  unaryNeedsLineBreak,
  writeBinaryLike,
  writeExpr,
  writeLambdaBody,
  writeLambdaParams,
  writeMaybeParenthesize,
  writeNode,
} from "../fmt/expr.js";
import { close, COLLAPSE, GROUP, HARD, open, openFitsExpanded, ruffOf, sLine, sText } from "../fmt/sink.js";

export const exprVia = {
  // The rule every `$.x.parens(mode)` names: ruff's `Parentheses` (keep the source's, always, never) outright, and
  // its `Parenthesize` modes by what the expression's parent needs.
  parens: (c: number, mode: string) => {
    const { f, e } = ruffOf(c);
    if (mode === "preserve" || mode === "always" || mode === "never") writeExpr(f, e, mode);
    else writeMaybeParenthesize(f, e, e.parent as Py, mode as Parenthesize);
  },
  "expr.lambdaParams": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(c));
    const l = e as Lambda;
    if (l.params) writeLambdaParams(f, l, l.params);
  },
  // An assignment's lambda (`ctx.args.lambdaAssign`, from ruff's caller) fits its body expanded.
  "expr.lambdaBody": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(c));
    const l = e as Lambda;
    const header = lambdaHeader(f, l);
    if (header.length === 0) sText(" ");
    if (ctx.args?.lambdaAssign !== true) {
      writeLambdaBody(f, l, header);
      return;
    }
    openFitsExpanded(-1);
    writeLambdaBody(f, l, header);
    close();
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
    f.writeTrailing(f.comments.dangling(e));
    if (lineBreak) sLine(HARD | COLLAPSE);
    else if (op === "not") sText(" ");
    writeExpr(f, operand, parens);
  },
  "expr.binaryLike": (c: number) => {
    const { f, e } = ruffOf(c);
    writeBinaryLike(f, e as BinOp | Compare | BoolOp);
  },
  "expr.ifBody": (c: number) => {
    const { f, e } = ruffOf(c);
    const x = e.parent as IfExp;
    writeExpr(f, e);
    f.writeSoftLineOrSpace();
    f.writeLeading(f.comments.leading(x.test));
  },
  "expr.ifTest": (c: number) => {
    const { f, e } = ruffOf(c);
    const x = e.parent as IfExp;
    writeExpr(f, e);
    f.writeSoftLineOrSpace();
    f.writeLeading(f.comments.leading(x.orelse));
  },
  "expr.ifOrelse": (c: number) => {
    const { f, e: orelse } = ruffOf(c);
    if (orelse.kind === "IfExp" && orelse.parens.length === 0)
      writeNode(f, orelse, { ifNested: true });
    else f.writeInParensGroup(() => writeExpr(f, orelse));
  },
  "expr.namedTarget": (c: number) => {
    const { f, e } = ruffOf(c);
    open(GROUP);
    writeExpr(f, e);
    f.writeSoftLineOrSpace();
    close();
  },
  "expr.namedValue": (c: number) => {
    const { f, e } = ruffOf(c);
    const dangling = f.comments.dangling(e.parent as Named);
    if (dangling.length === 0) sText(" ");
    else {
      f.writeDangling(dangling);
      sLine(HARD | COLLAPSE);
    }
    writeExpr(f, e);
  },
};
