// Literals, strings, templates and identifiers (customs: print/literals.ts).
import { custom, text } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const literals = {
  number: () => text("printNumber"),
  regex: ($) => ["/", $.pattern, "/", $.flags.andThen((f) => f)],
  regex_flags: () => text("sortRegexFlags"),
  string: () => custom("string"),
  template_string: () => custom("templateString"),
} satisfies JsStructure;
