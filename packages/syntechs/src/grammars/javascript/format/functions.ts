// Functions, arrows, parameters and methods' values (customs: print/functions.ts).
import { custom, space } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const functions = {
  function_declaration: () => custom("function"),
  function_expression: () => custom("function"),
  generator_function: () => custom("function"),
  generator_function_declaration: () => custom("function"),
  function_signature: () => custom("function"),
  required_parameter: () => custom("parameter"),
  optional_parameter: () => custom("parameter"),
  assignment_pattern: ($) => [$.left, space, "=", space, $.right],
} satisfies JsStructure;
