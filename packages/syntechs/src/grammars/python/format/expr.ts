// Expressions: operators, lambdas, await and yield, and atoms: the rest that is neither access, a collection, nor a string.
import { custom, space, text, tok, verbatim } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const expr = {
  identifier: () => verbatim,
  integer: () => text("ruffNumber"),
  float: () => text("ruffNumber"),
  true: () => verbatim,
  false: () => verbatim,
  none: () => verbatim,
  ellipsis: () => verbatim,

  not_operator: ($) => ["not", $.argument.via("expr.unaryOperand")],
  unary_operator: ($) => [$.operator, $.argument.via("expr.unaryOperand")],
  await: ($) => ["await", space, $.children.parens("ifBreaks")],
  yield: ($) => [
    "yield",
    tok("from").andThen((f) => [space, f]),
    $.children.andThen((v) => [space, v.parens("optional")]),
  ],

  // Ruff lays out a whole chain of operators at once, `a and b and c` as one node.
  binary_operator: () => custom("expr.binaryLike"),
  boolean_operator: () => custom("expr.binaryLike"),
  comparison_operator: () => custom("expr.binaryLike"),

  // Each branch's custom prints the line break after it, and the next branch's leading comments before its keyword.
  conditional_expression: ($) => [
    $.children.at(0).andThen((b) => b.via("expr.ifBody")),
    "if",
    space,
    $.children.at(1).andThen((t) => t.via("expr.ifTest")),
    "else",
    space,
    $.children.at(2).andThen((o) => o.via("expr.ifOrelse")),
  ],
  // The header's dangling comments print around the parameters and the body, where ruff splits them at `:`.
  lambda: ($) => [
    "lambda",
    $.parameters.andThen((p) => p.via("expr.lambdaParams")),
    ":",
    $.body.via("expr.lambdaBody"),
  ],
  named_expression: ($) => [$.name.via("expr.namedTarget"), ":=", $.value.via("expr.namedValue")],
} satisfies Structure;
