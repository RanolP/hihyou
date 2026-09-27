// Classes, interfaces and decorators (customs: print/classes.ts).
import { custom, type FormatSpec, space, tok } from "../../../fmt/dsl/dsl.js";
import type { grammar } from "../bundle.js";
import type { JsStructure } from "../format.js";
import type { JsOptions } from "../print/util.js";

// tree-sitter-javascript's name for TS's public_field_definition; the spec is typed against tsx, which lacks it.
const jsOnly = {
  field_definition: () => [tok("=").via("class.property"), tok(";").via("class.semi")],
} satisfies FormatSpec<typeof grammar, JsOptions>["structure"];

export const classes = {
  class: () => custom("class"),
  class_declaration: () => custom("class"),
  abstract_class_declaration: () => custom("class"),
  interface_declaration: () => custom("class"),
  class_body: () => custom("class.body"),
  ...jsOnly,
  public_field_definition: () => [tok("=").via("class.property"), tok(";").via("class.semi")],
  class_static_block: ($) => ["static", space, $.body],
  decorator: ($) => ["@", $.children],
} satisfies JsStructure;
