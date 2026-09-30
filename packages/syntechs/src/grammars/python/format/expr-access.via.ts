// The customs expr-access.ts's `.via`s name.
import type { Frame } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx } from "../../../fmt/stream-format.js";
import type { Arguments, Attribute, Call, ClassDef, Expr, Py, Sequence, Slice, Subscript } from "../fmt/ast.js";
import type { Fmt } from "../fmt/builders.js";
import type { Comment } from "../fmt/comments.js";
import {
  type Chain,
  isCallLike,
  type TupleMode,
  writeArgs,
  writeArgumentItems,
  writeArgumentsFrame,
  writeChainValue,
  writeExpr,
  writeNode,
  writeTuple,
} from "../fmt/expr.js";
import { COLLAPSE, HARD, ruffOf, ruffStmtOf, SOFT, sLine, sLineSuffixBoundary, sText } from "../fmt/sink.js";
import { startOf, tokens } from "../fmt/trivia.js";

/** The call chain layout the attribute, call or subscript printing now continues (`fields` passes it). */
const layoutOf = (ctx: StreamCtx<unknown>): Chain => (ctx.args?.chain as Chain | undefined) ?? "nonFluent";

/**
 * Ruff's preview `fluent_layout_split_first_call`: whether the attribute a call or subscript applies to, with value
 * `v`, is the chain's first call-like one. Its value is then a run of attributes down to an unparenthesized root
 * other than a call or subscript (a parenthesized root counts as a call of its own, so none is first).
 */
function isFirstCallLike(f: Fmt, v: Expr, called: boolean): boolean {
  if (f.options.preview !== true || !called) return false;
  let x = v;
  while (x.kind === "Attribute") {
    if (x.value.parens.length > 0) return false;
    x = x.value;
  }
  return x.kind !== "Call" && x.kind !== "Subscript";
}

function isBaseTenNumber(f: Fmt, e: Expr): boolean {
  if (e.kind !== "Number") return false;
  const t = f.text(e.ts);
  return !/^0[bBoOxX]/.test(t) && !/[jJ]$/.test(t);
}

/** A subscript's slice between its brackets, a tuple keeping its own parentheses or none. */
function writeSubscriptContent(f: Fmt, e: Subscript): void {
  const s = e.slice;
  f.writeParenthesizedContent(
    () => (s.kind === "Tuple" ? writeExpr(f, s, "preserve", { tuple: "preserve" }) : writeExpr(f, s)),
    f.comments.dangling(e),
  );
}

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

/** Argument list `n`'s arguments, a call's or a class's. */
function argumentsOf(n: number, ctx: StreamCtx<unknown>): { f: Fmt; a: Arguments } {
  if (ctx.tree.kindName(ctx.tree.parent(n)) === "class_definition") {
    const { f, s } = ruffStmtOf(n);
    return { f, a: (s as ClassDef).args as Arguments };
  }
  const { f, e } = ruffOf(ctx.tree.parent(n));
  return { f, a: (e as Call).args };
}

const sliceOf = (n: number) => ruffOf(n) as { f: Fmt; e: Slice };

export const exprAccessVia = {
  "access.sliceLower": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = sliceOf(ctx.tree.parent(c));
    writeExpr(f, e.lower as Expr);
    // A bound's end-of-line comment puts the colon after it on the next line.
    sLineSuffixBoundary();
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
    sLineSuffixBoundary();
  },
  // The second colon, after the comments before it; with no step, the comments after it too.
  "access.sliceStepColon": (token: number | undefined, n: number) => {
    const { f, e } = sliceOf(n);
    const { spaced, secondColon, afterSecond } = sliceLayout(f, e);
    if (token === undefined) {
      f.writeDangling(secondColon);
      return;
    }
    // Also spaced with neither upper nor step: `x[a() : :]`.
    if (spaced && (e.upper || !e.step)) sText(" ");
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
  "access.parenthesized": (c: number, ctx: StreamCtx<unknown>) => {
    const { f } = ruffOf(ctx.tree.parent(c));
    const { content, dangling, hug } = ctx.args as {
      content: () => void;
      dangling: readonly Comment[];
      hug?: boolean;
    };
    f.writeParenthesizedContent(content, dangling, hug);
  },
  // The value, then the line break before the dot: an end-of-line comment after the value's closing parenthesis
  // forces one, and a fluent chain breaks before each dot that follows a call, subscript or parenthesized value.
  "access.attributeValue": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e: v } = ruffOf(c);
    const layout = layoutOf(ctx);
    const parenthesizeValue = isBaseTenNumber(f, v) || v.parens.length > 0;
    if (layout === "fluent" && !parenthesizeValue && isCallLike(v)) writeNode(f, v, { chain: layout });
    else writeExpr(f, v, parenthesizeValue ? "always" : "never");
    let lastClose: number | undefined;
    for (const t of tokens(f.tree, v.end)) {
      if (t.kind !== ")") break;
      lastClose = t.end;
    }
    const eol =
      lastClose !== undefined &&
      f.comments.trailing(v).some((c) => c.line === "eol" && c.start > (lastClose as number));
    if (eol) sLine(HARD | COLLAPSE);
    else if (
      layout === "fluent" &&
      (parenthesizeValue ||
        v.kind === "Call" ||
        v.kind === "Subscript" ||
        isFirstCallLike(f, v, ctx.args?.called === true))
    )
      sLine(SOFT | COLLAPSE);
  },
  // The dot, between the attribute's dangling comments before and after it.
  "access.dot": (token: number | undefined, n: number) => {
    const { f, e } = ruffOf(n);
    const { dot } = e as Attribute;
    const dangling = f.comments.dangling(e);
    const at = startOf(f.tree, dot);
    f.writeDangling(dangling.filter((c) => c.start < at));
    if (token !== undefined) f.writeTok(token);
    f.writeDangling(dangling.filter((c) => c.start >= at));
  },
  "access.chainValue": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(c);
    writeChainValue(f, e, layoutOf(ctx));
  },
  // A call's dangling comments, then its arguments.
  "access.arguments": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(c));
    f.writeDangling(f.comments.dangling(e));
    writeArgs(f, (e as Call).args);
  },
  "access.subscript": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(c));
    writeSubscriptContent(f, e as Subscript);
  },
  // A generic type's type_parameter: its brackets and what is between them.
  "access.typeSubscript": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(ctx.tree.parent(c));
    const s = e as Subscript;
    f.writeTok(s.open);
    writeSubscriptContent(f, s);
    f.writeTok(s.close);
  },
  "access.argumentsFrame": (n: number, ctx: StreamCtx<unknown>, frame: Frame) => {
    const { f, a } = argumentsOf(n, ctx);
    writeArgumentsFrame(f, a, frame.open, frame.body, frame.close);
  },
  "access.argumentItems": (c: number, ctx: StreamCtx<unknown>) => {
    const { f, a } = argumentsOf(ctx.tree.parent(c), ctx);
    writeArgumentItems(f, a);
  },
  "access.tuple": (n: number, ctx: StreamCtx<unknown>) => {
    const { f, e } = ruffOf(n);
    writeTuple(f, e as Sequence, (ctx.args?.tuple as TupleMode | undefined) ?? "default");
  },
  // The splat's dangling comments, between its star and its value, print with the value.
  "access.starredValue": (c: number) => {
    const { f, e } = ruffOf(c);
    f.writeDangling(f.comments.dangling(e.parent as Py));
    writeExpr(f, e);
  },
};
