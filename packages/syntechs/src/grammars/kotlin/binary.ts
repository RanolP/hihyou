// A binary expression (`a + b + c`, `x ?: y`) as ktfmt 0.64 lays it out: its KotlinInputAstVisitor's
// visitBinaryExpression, carried from google-java-format's levels into the stream's prettier-style groups.
import { close, GROUP, INDENT, open, sHardline, sLine, sText } from "../../fmt/stream.js";
import {
  commentFacts,
  printLeadingComment,
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
  type StreamRule,
} from "../../fmt/stream-format.js";

/** The grammar's kinds for PSI's KtBinaryExpression; `a is T` and `a as T` are other PSI kinds. */
export const binaryKinds = new Set([
  "additive_expression",
  "multiplicative_expression",
  "comparison_expression",
  "equality_expression",
  "conjunction_expression",
  "disjunction_expression",
  "elvis_expression",
  "infix_expression",
  "check_expression",
]);

/** `node`'s left operand, operator and right operand, or undefined when it is no binary expression PSI knows. */
function operands(ctx: StreamCtx<unknown>, node: number): readonly [number, number, number] | undefined {
  const t = ctx.tree;
  if (!binaryKinds.has(t.kindName(node))) return undefined;
  const items: number[] = [];
  for (let i = 0; i < t.count(node); i++) if (!ctx.isComment(t.child(node, i))) items.push(t.child(node, i));
  if (items.length !== 3) return undefined;
  const [left, op, right] = items as [number, number, number];
  const text = t.text(op);
  if (text === "is" || text === "!is") return undefined;
  return [left, op, right];
}

/** PSI's operationToken: every named infix call (`a to b shl c`) is the one token IDENTIFIER. */
const token = (ctx: StreamCtx<unknown>, op: number) =>
  ctx.tree.kindName(op) === "simple_identifier" ? "IDENTIFIER" : ctx.tree.text(op);

/**
 * The comments between `op` and the operand before it, when they break the line before `op`
 * (hasLineBreakingCommentBefore: a line comment, or a block comment on a line of its own); else none.
 */
function commentsBreakingBefore(ctx: StreamCtx<unknown>, node: number, op: number): readonly number[] {
  const t = ctx.tree;
  const comments: number[] = [];
  for (let i = 0; i < t.count(node) && t.child(node, i) !== op; i++) {
    const c = t.child(node, i);
    if (ctx.isComment(c)) comments.push(c);
    else comments.length = 0;
  }
  const last = comments.at(-1);
  return last !== undefined && (ctx.isLineComment(last) || t.lf(last) > 0) ? comments : [];
}

/**
 * `rule` for the binary kinds: a run of one operator (`a + b + c`, left-nested in the tree) prints flat, its
 * operands after the first each breaking onto a line of their own, together, indented; an elvis breaks before its
 * `?:`, and an operator after a comment on a line of its own breaks on its own.
 */
export const binary =
  <O>(rule: StreamRule<O> | undefined): StreamRule<O> =>
  (node, ctx) => {
    const c = ctx as StreamCtx<unknown>;
    const top = operands(c, node);
    if (top === undefined) {
      rule?.(node, ctx);
      return;
    }
    const op = token(c, top[1]);
    const parts: number[] = [];
    for (let n = node; ; ) {
      const o = operands(c, n);
      if (o === undefined || token(c, o[1]) !== op) break;
      parts.unshift(n);
      n = o[0];
    }
    for (let i = parts.length - 2; i >= 0; i--) printLeadingComments(c, parts[i] as number);
    ctx.print((operands(c, parts[0] as number) as readonly number[])[0] as number);
    for (const [i, part] of parts.entries()) {
      const [, operator, right] = operands(c, part) as readonly [number, number, number];
      const before = op === "?:" ? [] : commentsBreakingBefore(c, part, operator);
      if (op === "?:") {
        if (i === 0) {
          open(GROUP);
          open(INDENT);
        }
        sLine(0);
        ctx.print(operator);
        sText(" ");
      } else if (before.length > 0 && before.every((b) => c.leadingComments(right).includes(b))) {
        // The comments stay before the operator, each on a line of its own, and the operator's own break is
        // INDEPENDENT: it breaks only where the operand after it does not fit.
        if (i === 0) {
          open(GROUP);
          open(INDENT);
        }
        for (const comment of before) {
          sHardline();
          c.comment(comment);
        }
        sHardline();
        ctx.print(operator);
        open(GROUP);
        sLine(0);
        close();
        for (const comment of c.leadingComments(right))
          if (!before.includes(comment)) printLeadingComment(c, commentFacts(c, comment));
        ctx.printNode(right);
        printTrailingComments(c, right);
        if (part !== node) printTrailingComments(c, part);
        continue;
      } else {
        sText(" ");
        if (i === 0) {
          open(GROUP);
          open(INDENT);
        }
        ctx.print(operator);
        sLine(0);
      }
      ctx.print(right);
      if (part !== node) printTrailingComments(c, part);
    }
    close();
    close();
  };
