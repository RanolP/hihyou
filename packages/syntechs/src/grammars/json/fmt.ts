import { token } from "../../fmt/doc.js";
import { defineLanguage, type Rule } from "../../fmt/rules.js";
import { grammar } from "./bundle.js";

// Prettier's number normalization (utilities/print-number.js): lower case, no redundant exponent sign,
// zeroes or dot, and a leading digit.
const printNumber = (raw: string) =>
  raw.length === 1
    ? raw
    : raw
        .toLowerCase()
        .replace(/^([+-]?[\d.]+e)(?:\+|(-))?0*(?=\d)/, "$1$2")
        .replace(/^([+-]?[\d.]+)e[+-]?0+$/, "$1")
        .replace(/^([+-])?\./, "$10.")
        .replace(/(\.\d+?)0+(?=e|$)/, "$1")
        .replace(/\.(?=e|$)/, "");

const number: Rule = (node, ctx) =>
  token(node, printNumber(ctx.source.slice(node.start, node.end)));

const fitting = (trailingSep: boolean) =>
  defineLanguage(grammar, { lineComments: { comment: "//" } }, (h) => ({
    document: h.block(),
    object: h.list({
      open: "{",
      close: "}",
      sep: ",",
      pad: true,
      keepExpanded: true,
      blankLines: "force",
      trailingSep,
    }),
    array: h.list({
      open: "[",
      close: "]",
      sep: ",",
      fillIfAll: ["number"],
      breakNestedLists: true,
      groupItems: true,
      blankLines: "ifBroken",
      trailingSep,
    }),
    pair: h.seq(h.field("key"), ":", h.space, h.field("value")),
    string: h.verbatim(),
    number,
  }));

/** JSON as prettier's `json` parser prints it: lists fit on a line when they can, comments allowed. */
export const json = fitting(false);
/** JSON with Comments (`.jsonc`, VS Code and Sublime settings) as prettier's `jsonc` parser prints it: like
 * `json`, plus a trailing comma in every broken list. */
export const jsonc = fitting(true);

/** JSON as prettier's `json-stringify` parser prints it, like `JSON.stringify(value, null, 2)`: every list broken. */
export const jsonStringify = defineLanguage(
  grammar,
  { lineComments: { comment: "//" } },
  (h) => ({
    document: h.block(),
    object: h.list({
      open: "{",
      close: "}",
      sep: ",",
      blankLines: "force",
      expand: "always",
    }),
    array: h.list({
      open: "[",
      close: "]",
      sep: ",",
      blankLines: "ifBroken",
      expand: "always",
    }),
    pair: h.seq(h.field("key"), ":", h.space, h.field("value")),
    string: h.verbatim(),
  }),
);

/**
 * The language prettier 3.9.9 picks for a file name: `json-stringify` for the files npm and composer rewrite,
 * `jsonc` for the JSON with Comments extensions, else `json` (tsconfig.json included).
 */
export function jsonLanguageFor(path: string) {
  if (
    /(^|[\\/])(package\.json|package-lock\.json|composer\.json)$|\.importmap$/.test(
      path,
    )
  )
    return jsonStringify;
  if (/\.(jsonc|code-snippets|code-workspace|sublime[-_][a-z-]+)$/.test(path))
    return jsonc;
  return json;
}
