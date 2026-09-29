// A lambda with no statements, as ktfmt 0.64 `--kotlinlang-style` prints it: `{}`, `{ -> }`, `{ x -> }`, or its
// comments alone.
import { close, GROUP, INDENT, open, sHardline, sLine, sText, sToken } from "../../fmt/stream.js";
import { printLeadingComments, type StreamCtx, type StreamRule } from "../../fmt/stream-format.js";
import { tokenChild } from "../../fmt/dsl/runtime.js";

const kidOf = (ctx: StreamCtx<unknown>, node: number, kind: string) => {
  const t = ctx.tree;
  for (let i = 0; i < t.count(node); i++) if (t.kindName(t.child(node, i)) === kind) return t.child(node, i);
  return -1;
};

/** `rule`, the generated one, but for a lambda with no statements, which `bareLambda` prints. */
export function lambdas<O>(rule: StreamRule<O> | undefined): StreamRule<O> {
  return (node, ctx) => (kidOf(ctx, node, "statements") === -1 ? bareLambda(node, ctx) : rule?.(node, ctx));
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
