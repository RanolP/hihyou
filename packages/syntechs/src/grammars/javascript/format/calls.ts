// Calls, arguments, member chains and `new` (customs: print/calls.ts).
import { custom } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const calls = {
  non_null_expression: ($) => [$.children, "!"],
  member_expression: () => custom("member"),
  subscript_expression: () => custom("member"),
} satisfies JsStructure;
