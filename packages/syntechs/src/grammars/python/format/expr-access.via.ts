// The customs expr-access.ts's `.via`s name.
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { Expr, Py, Slice } from "../fmt/ast.js";
import type { Fmt } from "../fmt/builders.js";
import { formatExpr, writeExpr } from "../fmt/expr.js";
import { COLLAPSE, HARD, part, ruffOf, sLine, sText } from "../fmt/sink.js";
import { startOf } from "../fmt/trivia.js";

/**
 * Ruff's slice layout: spaces around the colons unless every bound is simple, and the dangling comments split into
 * those before the first colon, those up to the second, and those after it.
 */
function sliceLayout(f: Fmt, e: Slice) {
  const [c1, c2] = e.colons;
  const simple = (x: Expr | undefined): boolean =>
    x === undefined ||
    x.kind === "Name" ||
    x.kind === "Number" ||
    x.kind === "Bool" ||
    x.kind === "None" ||
    x.kind === "Ellipsis" ||
    x.kind === "Str" ||
    (x.kind === "UnaryOp" && f.text(x.op) !== "not" && simple(x.operand));
  const spaced = !(simple(e.lower) && simple(e.upper) && simple(e.step));
  const dangling = f.comments.dangling(e);
  const c1Start = c1 === undefined ? undefined : startOf(f.tree, c1);
  const c2Start = c2 === undefined ? undefined : startOf(f.tree, c2);
  const rest = dangling.filter((c) => c1Start !== undefined && c.start >= c1Start);
  return {
    spaced,
    firstColon: dangling.filter((c) => c1Start === undefined || c.start < c1Start),
    secondColon: rest.filter((c) => c2Start === undefined || c.start < c2Start),
    afterSecond: rest.filter((c) => c2Start !== undefined && c.start >= c2Start),
  };
}

/** An upper bound or step: after its colon, a space when spaced, or the break or gap its first leading comment needs. */
function writeSliceBound(f: Fmt, x: Expr, spaced: boolean): void {
  const first = f.comments.leading(x)[0];
  if (first) {
    if (first.line === "own") sLine(HARD | COLLAPSE);
    else sText("  ");
  } else if (spaced) sText(" ");
  writeExpr(f, x);
}

const sliceOf = (n: number) => ruffOf(n) as { f: Fmt; e: Slice };

export const exprAccessVia = {
  "access.sliceLower": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = sliceOf(ctx.tree.parent(c));
    writeExpr(f, e.lower as Expr);
  },
  "access.sliceColon": (token: number | undefined, n: number) => {
    if (token === undefined) return;
    const { f, e } = sliceOf(n);
    const { spaced, firstColon } = sliceLayout(f, e);
    if (spaced && e.lower) sText(" ");
    f.writeDangling(firstColon);
    f.writeTok(token);
  },
  "access.sliceUpper": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = sliceOf(ctx.tree.parent(c));
    writeSliceBound(f, e.upper as Expr, sliceLayout(f, e).spaced);
  },
  // The second colon, after the comments before it; with no step, the comments after it too.
  "access.sliceStepColon": (token: number | undefined, n: number) => {
    const { f, e } = sliceOf(n);
    const { spaced, secondColon, afterSecond } = sliceLayout(f, e);
    if (token === undefined) {
      f.writeDangling(secondColon);
      return;
    }
    if (spaced && e.upper) sText(" ");
    f.writeDangling(secondColon);
    f.writeTok(token);
    if (!e.step) f.writeDangling(afterSecond);
  },
  "access.sliceStep": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = sliceOf(ctx.tree.parent(c));
    const { spaced, afterSecond } = sliceLayout(f, e);
    writeSliceBound(f, e.step as Expr, spaced);
    f.writeDangling(afterSecond);
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
