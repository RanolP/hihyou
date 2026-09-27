// Functions, arrows, parameters and methods' values (customs: print/functions.ts).
import { custom, space } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const functions = {
  required_parameter: () => custom("parameter"),
  optional_parameter: () => custom("parameter"),
  assignment_pattern: ($) => [$.left, space, "=", space, $.right],
} satisfies JsStructure;
