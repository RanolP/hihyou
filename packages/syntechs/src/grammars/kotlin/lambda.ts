// A lambda with no statements, as ktfmt 0.64 `--kotlinlang-style` prints it: `{}`, `{ -> }`, `{ x -> }`, or its
// comments alone.
import { close, GROUP, INDENT, open, sHardline, sLine, sText, sToken } from "../../fmt/stream.js";
import {
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
  type StreamRule,
} from "../../fmt/stream-format.js";
import { tokenChild } from "../../fmt/dsl/runtime.js";

const kidOf = (ctx: StreamCtx<unknown>, node: number, kind: string) => {
  const t = ctx.tree;
  for (let i = 0; i < t.count(node); i++) if (t.kindName(t.child(node, i)) === kind) return t.child(node, i);
  return -1;
};

/** `rule`, the generated one, but for a lambda with no statements, which `bareLambda` prints. */
export function lambdas<O>(rule: StreamRule<O> | undefined): StreamRule<O> {
  return (node, ctx) => {
    if (kidOf(ctx, node, "statements") === -1) bareLambda(node, ctx);
    else if (!commentedHeader(node, ctx)) rule?.(node, ctx);
  };
}

/**
 * A lambda whose header holds a line comment before its `->`, which ktfmt prints on lines of their own: without
 * parameters, the comments and the `->` at the lambda's own indent (`{`, `//`, `->`); with them, the parameters
 * indented on the next line, and the `->` on the line after the comment, one space in (`a //`, ` ->`). Returns
 * whether it printed the lambda.
 */
function commentedHeader(node: number, ctx: StreamCtx<unknown>): boolean {
  const t = ctx.tree;
  const arrow = tokenChild(t, node, "->", 0);
  if (arrow === -1) return false;
  const params = kidOf(ctx, node, "lambda_parameters");
  const statements = kidOf(ctx, node, "statements");
  const before = (c: number) => t.ord(c) < t.ord(arrow);
  const header =
    params === -1 ? ctx.leadingComments(statements).filter(before) : ctx.trailingComments(params).filter(before);
  if (!header.some((c) => lineLike(ctx, c))) return false;

  sToken(tokenChild(t, node, "{", 0), "{");
  if (params === -1) {
    for (const c of header) {
      sHardline();
      ctx.comment(c);
    }
    sHardline();
    sToken(arrow, "->");
    open(INDENT);
  } else {
    open(INDENT);
    sHardline();
    ctx.print(params);
    sHardline();
    sText(" ");
    sToken(arrow, "->");
  }
  for (const c of ctx.leadingComments(statements)) {
    if (header.includes(c)) continue;
    sHardline();
    ctx.comment(c);
  }
  sHardline();
  ctx.printNode(statements);
  printTrailingComments(ctx, statements);
  close();
  sHardline();
  sToken(tokenChild(t, node, "}", 0), "}");
  return true;
}

/**
 * The comments after the `{` (or the `->`) print as the body. A lone block comment stays on the braces' line while
 * it fits; any other comments put the lambda on lines of their own, one per line but a line comment the source
 * keeps on the line before it, which ends that line (`{ // no-op`).
 */
function bareLambda(node: number, ctx: StreamCtx<unknown>): void {
  const t = ctx.tree;
  const params = kidOf(ctx, node, "lambda_parameters");
  const arrow = tokenChild(t, node, "->", 0);
  const opener = arrow === -1 ? tokenChild(t, node, "{", 0) : arrow;
  // The grammar attaches a comment after the `->` to the parameters before it.
  const trailing = params === -1 ? [] : ctx.trailingComments(params);
  const body = [...trailing.filter((c) => t.ord(c) > t.ord(opener)), ...ctx.danglingComments(node)].sort(
    (a, b) => t.ord(a) - t.ord(b),
  );

  sToken(tokenChild(t, node, "{", 0), "{");
  if (params !== -1) {
    sText(" ");
    printLeadingComments(ctx, params);
    ctx.printNode(params);
    for (const c of trailing) {
      if (t.ord(c) > t.ord(opener)) continue;
      sText(" ");
      ctx.comment(c);
    }
  }
  if (arrow !== -1) {
    sText(" ");
    sToken(arrow, "->");
  }
  const close_ = tokenChild(t, node, "}", 0);
  if (body.length === 0) {
    if (params !== -1 || arrow !== -1) sText(" ");
    sToken(close_, "}");
    return;
  }
  if (body.length === 1 && !lineLike(ctx, body[0] as number)) {
    open(GROUP);
    open(INDENT);
    sLine(0);
    ctx.comment(body[0] as number);
    close();
    sLine(0);
    sToken(close_, "}");
    close();
    return;
  }
  open(INDENT);
  for (const c of body) {
    if (lineLike(ctx, c) && t.lf(c) === 0) sText(" ");
    else sHardline();
    ctx.comment(c);
  }
  close();
  sHardline();
  sToken(close_, "}");
}

const lineLike = (ctx: StreamCtx<unknown>, c: number) => ctx.isLineComment(c) || ctx.endsItsLine?.(c) === true;

/**
 * A lambda's parameters, which ktfmt keeps on the `{`'s line whatever their width, but a line comment after a
 * parameter ends the line, and the next parameter starts one of its own. ktfmt drops a trailing comma.
 */
export const lambdaParameters: StreamRule<unknown> = (node, ctx) => {
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  let item = -1;
  for (let i = 0; i < t.count(node); i++) {
    const c = t.child(node, i);
    if (t.named(c) && !items.has(c)) continue;
    if (t.kindName(c) === "," && item === ctx.items(node).at(-1)) continue;
    // A destructuring's type, `(a, b): Pair<A, B>`.
    if (t.kindName(c) === ":") {
      sToken(c, ":");
      sText(" ");
      continue;
    }
    if (t.kindName(c) === ",") {
      sToken(c, ",");
      if (ctx.trailingComments(item).some((k) => ctx.isLineComment(k))) sHardline();
      else sText(" ");
      continue;
    }
    ctx.print(c);
    item = c;
  }
};
