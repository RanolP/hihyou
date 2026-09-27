// Classes, interfaces and decorators (customs: print/classes.ts).
import { custom, space } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const classes = {
  class: () => custom("class"),
  class_declaration: () => custom("class"),
  abstract_class_declaration: () => custom("class"),
  interface_declaration: () => custom("class"),
  class_static_block: ($) => ["static", space, $.body],
  decorator: ($) => ["@", $.children],
} satisfies JsStructure;
