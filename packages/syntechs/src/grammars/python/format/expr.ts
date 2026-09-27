// Expressions: operators, lambdas, await and yield, and atoms: the rest that is neither access, a collection, nor a string.
import { custom, verbatim } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const expr = {
  identifier: () => verbatim,
  integer: () => custom("expr.number"),
  float: () => custom("expr.number"),
  true: () => verbatim,
  false: () => verbatim,
  none: () => verbatim,
  ellipsis: () => verbatim,
} satisfies Structure;
