// Literals, strings, templates and identifiers (customs: print/literals.ts).
import { all, allBefore, ancestor, any, custom, either, has, kindIs, parentIs, text } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

/** A bare string statement. */
const stringStatement = all(kindIs("expression_statement"), has("children", "string"));

/** A function body: a block right under a function. */
const functionBody = ancestor("statement_block", {
  stop: "*",
  holds: ancestor(
    [
      "function_declaration",
      "function_expression",
      "generator_function",
      "generator_function_declaration",
      "arrow_function",
      "method_definition",
    ],
    { stop: "*" },
  ),
});

/** The string is a directive: a bare string statement among the first statements of a program or function body. */
const directive = ancestor("expression_statement", {
  stop: "*",
  holds: all(
    any(ancestor("program", { stop: "*" }), functionBody),
    allBefore(any(kindIs("hash_bang_line"), stringStatement)),
  ),
});

export const literals = {
  // Babel's name for `\u0061b` is `ab`, which prettier prints.
  identifier: () => text("cook"),
  number: () => text("printNumber"),
  regex: ($) => ["/", $.pattern, "/", $.flags.andThen((f) => f)],
  regex_flags: () => text("sortRegexFlags"),
  string: () =>
    either(
      parentIs("jsx_attribute"),
      text("jsxString"),
      either(directive, text("directive"), text("requote")),
    ),
  template_string: () => custom("templateString"),
} satisfies JsStructure;
