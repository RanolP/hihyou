// Classes, interfaces and decorators (customs: print/classes.ts).
import {
  custom,
  either,
  type FormatSpec,
  hardline,
  indent,
  isEmpty,
  lines,
  space,
  tok,
} from "../../../fmt/dsl/dsl.js";
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
  // A method's decorators parse as its siblings in the class body; they print with the member they precede.
  class_body: ($) => [
    "{",
    either(isEmpty, [], [indent([hardline, lines($.children, { attach: $.decorator })]), hardline]),
    "}",
  ],
  ...jsOnly,
  public_field_definition: () => [tok("=").via("class.property"), tok(";").via("class.semi")],
  abstract_method_signature: () => custom("class.abstractMethod"),
  class_static_block: ($) => ["static", space, $.body],
  decorator: ($) => ["@", $.children],
} satisfies JsStructure;
