// Expressions: operators, lambdas, await and yield, and atoms: the rest that is neither access, a collection, nor a string.
import { custom, space, tok, verbatim } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const expr = {
  identifier: () => verbatim,
  integer: () => custom("expr.number"),
  float: () => custom("expr.number"),
  true: () => verbatim,
  false: () => verbatim,
  none: () => verbatim,
  ellipsis: () => verbatim,

  not_operator: ($) => ["not", $.argument.via("expr.unaryOperand")],
  unary_operator: ($) => ["+", "-", "~", $.argument.via("expr.unaryOperand")],
  await: ($) => ["await", space, $.children.via("expr.awaitValue")],
  yield: ($) => [
    "yield",
    tok("from").via("expr.yieldFrom"),
    $.children.andThen((v) => [space, v.via("expr.yieldValue")]),
  ],

  // Ruff lays out a whole chain of operators at once, `a and b and c` as one node.
  binary_operator: () => custom("expr.binaryLike"),
  boolean_operator: () => custom("expr.binaryLike"),
  comparison_operator: () => custom("expr.binaryLike"),
} satisfies Structure;
