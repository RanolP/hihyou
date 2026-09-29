// JSON's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts.
//
// Typed against the javascript grammar, not tree-sitter-json: prettier's JSON parsers read a file as one babel
// expression, so they accept JSON5 and more (single-quoted strings, bare and numeric keys, trailing commas,
// `+1`, hex, `Infinity`), which tree-sitter-json only recovers from as ERROR nodes.
import {
  defineFormat,
  either,
  fieldIs,
  firstText,
  grpBrace,
  grpBracket,
  lines,
  option,
  sepBy,
  space,
  text,
} from "../../fmt/dsl/dsl.js";
import type { grammar } from "../javascript/bundle.js";
import type { JsonOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, JsonOptions>();

const pair = { group: true } as const;

/** `json` and `jsonc`: lists fit on a line when they can; `jsonc` adds a trailing comma to a broken one. */
const fitting = (trailingComma: boolean) => {
  const trailing = trailingComma && option("trailingComma").isNot("none");
  const objectWrap = {
    keepExpanded: option("objectWrap").is("preserve"),
    blankLines: "force",
  } as const;
  return format({
    structure: {
      program: ($) => lines($.children),
      expression_statement: ($) => $.children,
      // A file that is only `{}` reads as an empty block.
      statement_block: ($) =>
        grpBrace(sepBy(",", $.children, { trailing }), {
          pad: option("bracketSpacing"),
        }),
      object: ($) =>
        grpBrace(sepBy(",", $.children, { trailing }), {
          pad: option("bracketSpacing"),
        }),
      array: ($) => grpBracket(sepBy(",", $.children, { trailing })),
      pair: ($) => [$.key, ":", space, $.value],
      unary_expression: ($) => [$.operator, $.argument],
      string: () => text("doubleQuote"),
      property_identifier: () => text("quoteKey"),
      number: () =>
        either(fieldIs("key"), text("numberKey"), text("printNumber")),
    },
    wrapping: {
      statement_block: objectWrap,
      object: objectWrap,
      array: {
        // Prettier's concisely printed array holds numbers and signed numbers only.
        packWhenAllOf: ["number"],
        breakMatrix: true,
        itemsAsGroups: true,
        blankLines: "ifBroken",
      },
      pair,
    },
  });
};

export const json = fitting(false);
export const jsonc = fitting(true);

/** `json-stringify`: every list broken, numbers as written, a `+` sign dropped. */
export const jsonStringify = format({
  structure: {
    program: ($) => lines($.children),
    expression_statement: ($) => $.children,
    statement_block: ($) => grpBrace(sepBy(",", $.children)),
    object: ($) => grpBrace(sepBy(",", $.children)),
    array: ($) => grpBracket(sepBy(",", $.children)),
    pair: ($) => [$.key, ":", space, $.value],
    unary_expression: ($) =>
      either(firstText({ is: ["+"] }), $.argument, [$.operator, $.argument]),
    string: () => text("doubleQuote"),
    property_identifier: () => text("quoteKey"),
    number: () => text("rawNumberKey", fieldIs("key")),
  },
  wrapping: {
    object: { expand: "always", blankLines: "force" },
    statement_block: { expand: "always", blankLines: "force" },
    array: { expand: "always", blankLines: "ifBroken" },
    pair,
  },
});
