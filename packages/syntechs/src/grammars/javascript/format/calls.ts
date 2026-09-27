// Calls, arguments, member chains and `new` (customs: print/calls.ts).
import type { JsStructure } from "../format.js";

export const calls = {
  non_null_expression: ($) => [$.children, "!"],
} satisfies JsStructure;
