// Objects, their patterns and members (customs: print/objects.ts).
import { custom, space } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const objects = {
  object: () => custom("object"),
  object_pattern: () => custom("object"),
  enum_body: () => custom("object"),
  array: () => custom("array"),
  array_pattern: () => custom("array"),
  pair: () => custom("pair"),
  pair_pattern: () => custom("pair"),
  method_definition: () => custom("method"),
  object_assignment_pattern: ($) => [$.left, space, "=", space, $.right],
  computed_property_name: ($) => ["[", $.children, "]"],
  spread_element: ($) => ["...", $.children],
  rest_pattern: ($) => ["...", $.children],
} satisfies JsStructure;
