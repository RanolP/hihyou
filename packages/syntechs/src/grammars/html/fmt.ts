import { parseTree } from "../../core/index.js";
import type { Language as Grammar } from "../../core/language.js";
import type { Normalize } from "../../fmt/check.js";
import { brokenNodes } from "../../fmt/format.js";
import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { sText, withEmbedding } from "../../fmt/stream.js";
import { printInto } from "../../fmt/stream-format.js";
import { css } from "../css/fmt.js";
import { language as cssGrammar } from "../css/index.js";
import { javascript } from "../javascript/fmt.js";
import { language as jsGrammar } from "../javascript/index.js";
import { json } from "../json/fmt.js";
import { language as tsxGrammar } from "../tsx/index.js";
import { tsx, typescript } from "../typescript/fmt.js";
import { language as tsGrammar } from "../typescript/index.js";
import { grammar } from "./bundle.js";
import { language } from "./index.js";
import { type EmbeddedLanguage, parseHtml, printHtml, Unsupported } from "./print.js";

/** Each language a script or style holds: the grammar its content parses with and the formatter printing it. */
const EMBEDDED: Record<EmbeddedLanguage, [Grammar, unknown]> = {
  babel: [jsGrammar, javascript],
  typescript: [tsGrammar, typescript],
  tsx: [tsxGrammar, tsx],
  json: [jsGrammar, json],
  css: [cssGrammar, css],
};

const defaults: PrettierOptions = { ...prettierDefaults };

/**
 * Prettier reflows text and collapses the gaps in it, so a text or comment compares by its words; it requotes an
 * attribute value and closes a void element with `/>`, and it lowercases a doctype's `DOCTYPE` and `html`.
 */
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l) => {
    if (l.text === '"' || l.text === "'") return undefined;
    if (l.text === "/>") return ">";
    // A script's or style's content is its own language's to format; the check compares the HTML around it.
    if (tree.kindName(l.node) === "raw_text") return undefined;
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
          const { printWidth, tabWidth, useTabs } = ctx.options;
          const embed = (lang: EmbeddedLanguage, content: string) => {
            const [contentGrammar, formatter] = EMBEDDED[lang];
            const tree = parseTree(contentGrammar, content);
            if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) throw new Unsupported(`${lang} parse error`);
            withEmbedding({ anchor: node, token: undefined }, () =>
              printInto(tree, formatter as unknown as Language<PrettierOptions>, { printWidth, tabWidth, useTabs }),
            );
          };
          printHtml(parseHtml(text, true), text, { text: sText, tabWidth, embed });
        },
      ],
    ]),
    lists: new Set(),
    finalLine: () => true,
  },
};
