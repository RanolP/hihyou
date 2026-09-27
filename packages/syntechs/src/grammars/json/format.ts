// JSON's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts.
import {
  custom,
  defineFormat,
  grpBrace,
  grpBracket,
  lines,
  option,
  sepBy,
  space,
  verbatim,
} from "../../fmt/dsl/dsl.js";
import type { grammar } from "./bundle.js";
import type { JsonOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, JsonOptions>();

const pair = { group: true } as const;

/** `json` and `jsonc`: lists fit on a line when they can; `jsonc` adds a trailing comma to a broken one. */
const fitting = (trailingComma: boolean) => {
  const trailing = trailingComma && option("trailingComma").isNot("none");
  return format({
    structure: {
      document: ($) => lines($.children),
      object: ($) =>
        grpBrace(sepBy(",", $.children, { trailing }), {
          pad: option("bracketSpacing"),
        }),
      array: ($) => grpBracket(sepBy(",", $.children, { trailing })),
      pair: ($) => [$.key, ":", space, $.value],
      string: () => verbatim,
      number: () => custom("number"),
    },
    wrapping: {
      object: {
        keepExpanded: option("objectWrap").is("preserve"),
        blankLines: "force",
      },
      array: {
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

/** `json-stringify`: every list broken, numbers as written. */
export const jsonStringify = format({
  structure: {
    document: ($) => lines($.children),
    object: ($) => grpBrace(sepBy(",", $.children)),
    array: ($) => grpBracket(sepBy(",", $.children)),
    pair: ($) => [$.key, ":", space, $.value],
    string: () => verbatim,
  },
  wrapping: {
    object: { expand: "always", blankLines: "force" },
    array: { expand: "always", blankLines: "ifBroken" },
    pair,
  },
});
