// Calls, arguments, member chains and `new` (customs: print/calls.ts).
import { custom, inOrder } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const calls = {
  call_expression: () => custom("call"),
  new_expression: () => custom("call"),
  non_null_expression: ($) => [$.children, "!"],
  instantiation_expression: () => inOrder(),
  member_expression: () => custom("member"),
  subscript_expression: () => custom("member"),
} satisfies JsStructure;
