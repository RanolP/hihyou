// Prettier's expressionNeedsAsiProtection (semicolon/semicolon.js): with `semi: false`, a statement starting
// with one of these tokens would continue the previous line, so it is printed after a `;`.

import type { FormatNode } from "../../../fmt/tree.js";
import { canPrintParamsWithoutParens } from "./functions.js";
import { needsParens } from "./parens.js";
import { leftSide } from "./statements.js";
import { field, type JsCtx, unparen } from "./util.js";

const ALWAYS = new Set([
  "type_assertion",
  "array",
  "array_pattern",
  "template_string",
  "regex",
  "jsx_element",
  "jsx_self_closing_element",
]);

export function expressionNeedsAsiProtection(
  ctx: JsCtx,
  n: FormatNode,
): boolean {
  if (n.kind === "parenthesized_expression") {
    const inner = unparen(n);
    if (inner.kind === "parenthesized_expression" || needsParens(inner, ctx))
      return true;
    return expressionNeedsAsiProtection(ctx, inner);
  }
  if (ALWAYS.has(n.kind)) return true;
  if (
    n.kind === "arrow_function" &&
    !(
      ctx.options.arrowParens === "avoid" && canPrintParamsWithoutParens(ctx, n)
    )
  )
    return true;
  if (n.kind === "unary_expression") {
    const op = field(n, "operator")?.kind;
    if (op === "+" || op === "-") return true;
  }
  if (needsParens(n, ctx)) return true;
  const left = leftSide(n);
  return left !== undefined && expressionNeedsAsiProtection(ctx, left);
}
