import type { Normalize } from "../../fmt/check.js";
import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { sText } from "../../fmt/stream.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";
import { parseHtml, printHtml } from "./print.js";

const defaults: PrettierOptions = { ...prettierDefaults };

/**
 * Prettier reflows text and collapses the gaps in it, so a text or comment compares by its words; it requotes an
 * attribute value and closes a void element with `/>`, and it lowercases a doctype's `DOCTYPE` and `html`.
 */
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l) => {
    if (l.text === '"' || l.text === "'") return undefined;
    if (l.text === "/>") return ">";
    const words = l.text.replace(/\s+/g, " ").trim();
    return tree.kindName(l.node) === "doctype" ? words.toLowerCase() : words;
  });

const base = defineLanguage(grammar, {
  parser: language,
  lineComments: {},
  defaults,
  settings: prettierSettings,
  normalize,
  layoutBlind: true,
});

/**
 * HTML as prettier 3.9.9's printer lays it out (print.ts), whole from the document: the printer builds prettier's
 * own AST and prints comments with the nodes around them, so the core attaches none.
 */
export const html: Language<PrettierOptions> = {
  ...base,
  comments: new Set(),
  lineComments: new Map(),
  stream: {
    rules: new Map([
      [
        "document",
        (node, ctx) => {
          const text = ctx.tree.text(node);
          printHtml(parseHtml(text), text, { text: sText, tabWidth: ctx.options.tabWidth });
        },
      ],
    ]),
    lists: new Set(),
    finalLine: () => true,
  },
};
