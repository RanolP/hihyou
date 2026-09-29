import { NO_NODE } from "../../core/arena.js";
import { decimalValue, type Normalize } from "../../fmt/check.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import type { StreamRules } from "../../fmt/stream-format.js";
import { grammar, language } from "../javascript/index.js";
import { cook } from "../javascript/normalize.js";
import * as gen from "./fmt.gen.js";

/**
 * The prettier options its JSON printers read (prettier 3.9.9 ignores `singleQuote` and `quoteProps` there);
 * `trailingComma` only for `jsonc`, `bracketSpacing` and `objectWrap` not for `json-stringify`.
 */
export interface JsonOptions extends PrettierOptions {
  trailingComma: "all" | "es5" | "none";
}

const defaults: JsonOptions = { ...prettierDefaults, trailingComma: "all" };

// A string means its value whatever its quotes, a key its name whether quoted or not, a number its value
// whatever its spelling; a comma before a closing bracket (a trailing comma, not an array's hole) and a `+`
// sign (`json-stringify` drops it) mean nothing.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    const parent = tree.parent(l.node);
    const parentKind = parent === NO_NODE ? undefined : tree.kindName(parent);
    if (l.text === ",") {
      const next = lexemes[i + 1]?.text;
      const previous = lexemes[i - 1]?.text;
      if ((next === "]" || next === "}") && previous !== "," && previous !== "[")
        return undefined;
    }
    if (l.text === "+" && parentKind === "unary_expression") return undefined;
    const kind = tree.kindName(l.node);
    if (parentKind === "pair" && tree.fieldName(l.node) === "key")
      return `key:${kind === "string" ? cook(l.text.slice(1, -1)) : kind === "number" ? String(Number(l.text)) : l.text}`;
    if (kind === "string") return `str:${cook(l.text.slice(1, -1))}`;
    if (kind === "number") return decimalValue(l.text) ?? l.text.toLowerCase();
    return l.text;
  });

const spec = {
  parser: language,
  atoms: ["string"] as const,
  lineComments: { comment: "//" },
  defaults,
  settings: prettierSettings,
  normalize,
  layoutBlind: true,
};

// The layouts are src/grammars/json/format.ts, generated into fmt.gen.ts.
const define = (stream: StreamRules<JsonOptions>): Language<JsonOptions> => ({
  ...defineLanguage(grammar, spec),
  stream,
});

/** JSON as prettier's `json` parser prints it: lists fit on a line when they can, comments allowed. */
export const json = define(gen.json());
/** JSON with Comments (`.jsonc`, VS Code and Sublime settings) as prettier's `jsonc` parser prints it: like
 * `json`, plus a trailing comma in every broken list unless `trailingComma` is `none`. */
export const jsonc = define(gen.jsonc());

/** JSON as prettier's `json-stringify` parser prints it, like `JSON.stringify(value, null, 2)`: every list broken. */
export const jsonStringify = define(gen.jsonStringify());

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
