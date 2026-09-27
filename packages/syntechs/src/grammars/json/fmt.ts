import { decimalValue, type Normalize } from "../../fmt/check.js";
import { token } from "../../fmt/doc.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import { defineLanguage, type Rule } from "../../fmt/rules.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";

/**
 * The prettier options its JSON printers read (prettier 3.9.9 ignores `singleQuote` and `quoteProps` there);
 * `trailingComma` only for `jsonc`, `bracketSpacing` and `objectWrap` not for `json-stringify`.
 */
export interface JsonOptions extends PrettierOptions {
  trailingComma: "all" | "es5" | "none";
}

const defaults: JsonOptions = { ...prettierDefaults, trailingComma: "all" };

// A number means its value, whatever its spelling, and a comma before a closing bracket (jsonc's trailing
// comma) means nothing.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    const next = lexemes[i + 1]?.text;
    if (l.text === "," && (next === "]" || next === "}")) return undefined;
    return tree.kindName(l.node) === "number"
      ? (decimalValue(l.text) ?? l.text)
      : l.text;
  });

const spec = {
  parser: language,
  lineComments: { comment: "//" },
  defaults,
  settings: prettierSettings,
  normalize,
  layoutBlind: true,
};

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
  token(node, printNumber(ctx.tree.text(node)));

const fitting = (trailingSep: boolean) =>
  defineLanguage(grammar, spec, (h) => ({
    document: h.block(),
    object: h.list({
      open: "{",
      close: "}",
      sep: ",",
      pad: (o) => o.bracketSpacing,
      keepExpanded: (o) => o.objectWrap === "preserve",
      blankLines: "force",
      trailingSep: (o) => trailingSep && o.trailingComma !== "none",
    }),
    array: h.list({
      open: "[",
      close: "]",
      sep: ",",
      fillIfAll: ["number"],
      breakNestedLists: true,
      groupItems: true,
      blankLines: "ifBroken",
      trailingSep: (o) => trailingSep && o.trailingComma !== "none",
    }),
    pair: h.seq(h.field("key"), ":", h.space, h.field("value")),
    string: h.verbatim(),
    number,
  }));

/** JSON as prettier's `json` parser prints it: lists fit on a line when they can, comments allowed. */
export const json = fitting(false);
/** JSON with Comments (`.jsonc`, VS Code and Sublime settings) as prettier's `jsonc` parser prints it: like
 * `json`, plus a trailing comma in every broken list unless `trailingComma` is `none`. */
export const jsonc = fitting(true);

/** JSON as prettier's `json-stringify` parser prints it, like `JSON.stringify(value, null, 2)`: every list broken. */
export const jsonStringify = defineLanguage(grammar, spec, (h) => ({
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
}));

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
