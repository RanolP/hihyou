// Prettier's expressionNeedsAsiProtection (semicolon/semicolon.js): with `semi: false`, a statement starting
// with one of these tokens would continue the previous line, so it is printed after a `;`.

import { canPrintParamsWithoutParens } from "./functions.js";
import { needsParens } from "./parens.js";
import { leftSide } from "./statements.js";
import { field, isCastParen, type JsCtx, kind, unparen } from "./util.js";

const ALWAYS = new Set([
  "type_assertion",
  "array",
  "array_pattern",
  "template_string",
  "regex",
  "jsx_element",
  "jsx_self_closing_element",
]);

export function expressionNeedsAsiProtection(ctx: JsCtx, n: number): boolean {
  const k = kind(ctx, n);
  if (isCastParen(ctx, n)) return true;
  if (k === "parenthesized_expression") {
    const inner = unparen(ctx, n);
    if (
      kind(ctx, inner) === "parenthesized_expression" ||
      needsParens(inner, ctx)
    )
      return true;
    return expressionNeedsAsiProtection(ctx, inner);
  }
  if (ALWAYS.has(k)) return true;
  if (
    k === "arrow_function" &&
    !(
      ctx.options.arrowParens === "avoid" && canPrintParamsWithoutParens(ctx, n)
    )
  )
    return true;
  if (k === "unary_expression") {
    const op = kind(ctx, field(ctx, n, "operator"));
    if (op === "+" || op === "-") return true;
  }
  if (needsParens(n, ctx)) return true;
  const left = leftSide(ctx, n);
  return left !== undefined && expressionNeedsAsiProtection(ctx, left);
}
