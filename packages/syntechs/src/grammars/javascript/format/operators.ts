// Unary, update, yield, await, sequence and ternary operators (customs: print/operators.ts).
import { custom, inOrder, space } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const operators = {
  update_expression: () => inOrder(),
  yield_expression: ($) => ["yield", "*", $.children.andThen((a) => [space, a])],
  unary_expression: () => custom("unary"),
  await_expression: () => custom("await"),
  sequence_expression: () => custom("sequence"),
  ternary_expression: () => custom("ternary"),
  conditional_type: () => custom("ternary"),
} satisfies JsStructure;
