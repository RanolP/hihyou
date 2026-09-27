// The customs expr.ts's `.via`s name.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { BinOp, BoolOp, Compare, IfExp, Lambda, Named, Py, UnaryOp } from "../fmt/ast.js";
import {
  lambdaHeader,
  number,
  unaryNeedsLineBreak,
  writeBinaryLike,
  writeExpr,
  writeLambdaBody,
  writeLambdaParams,
  writeMaybeParenthesize,
  writeNode,
} from "../fmt/expr.js";
import { close, COLLAPSE, GROUP, HARD, open, openFitsExpanded, ruffOf, sLine, sText, sToken } from "../fmt/sink.js";

export const exprVia = {
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
    f.writeTrailing(f.comments.dangling(e));
    if (lineBreak) sLine(HARD | COLLAPSE);
    else if (op === "not") sText(" ");
    writeExpr(f, operand, parens);
  },
  "expr.awaitValue": (c: number) => {
    const { f, e } = ruffOf(c);
    writeMaybeParenthesize(f, e, e.parent as Py, "ifBreaks");
  },
  "expr.yieldFrom": (token: number | undefined, _: number, ctx: StreamCtx<unknown>) => {
    if (token === undefined) return;
    sText(" ");
    sToken(token, ctx.tree.text(token));
  },
  "expr.yieldValue": (c: number) => {
    const { f, e } = ruffOf(c);
    writeMaybeParenthesize(f, e, e.parent as Py, "optional");
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
