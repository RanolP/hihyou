import { parseTree } from "../../core/index.js";
import type { Language as Grammar } from "../../core/language.js";
import type { Normalize } from "../../fmt/check.js";
import { brokenNodes } from "../../fmt/format.js";
import { type PrettierOptions, prettierDefaults, prettierSettings } from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { close, IF_BROKEN, open, sText, withEmbedding } from "../../fmt/stream.js";
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
import { type EmbeddedLanguage, parseHtml, printHtml, Unsupported, type WhitespaceSensitivity } from "./print.js";

/** Each language a script or style holds: the grammar its content parses with and the formatter printing it. */
const EMBEDDED: Record<EmbeddedLanguage, [Grammar, unknown]> = {
  babel: [jsGrammar, javascript],
  typescript: [tsGrammar, typescript],
  tsx: [tsxGrammar, tsx],
  json: [jsGrammar, json],
  css: [cssGrammar, css],
};

export interface HtmlOptions extends PrettierOptions {
  bracketSameLine: boolean;
  singleAttributePerLine: boolean;
  htmlWhitespaceSensitivity: WhitespaceSensitivity;
}

const defaults: HtmlOptions = {
  ...prettierDefaults,
  bracketSameLine: false,
  singleAttributePerLine: false,
  htmlWhitespaceSensitivity: "css",
};

/**
 * The declarations of `a{...}`'s block, as a `style` attribute holds them: undefined when the block holds anything
 * else (a comment, a nested rule), which this printer leaves to the attribute as written.
 */
function cssBlockDeclarations(tree: ReturnType<typeof parseTree>): number[] | undefined {
  const kidsOf = (n: number) => Array.from({ length: tree.count(n) }, (_, i) => tree.child(n, i));
  const rule = kidsOf(tree.root);
  if (rule.length !== 1 || tree.kindName(rule[0] as number) !== "rule_set") return undefined;
  const block = kidsOf(rule[0] as number).find((c) => tree.kindName(c) === "block");
  if (block === undefined) return undefined;
  const decls: number[] = [];
  for (const c of kidsOf(block)) {
    const k = tree.kindName(c);
    if (k === "declaration") decls.push(c);
    else if (k !== "{" && k !== "}" && k !== ";") return undefined;
  }
  return decls.length > 0 ? decls : undefined;
}

function isStyleValue(tree: ReturnType<typeof parseTree>, value: number): boolean {
  let attribute = tree.parent(value);
  if (tree.kindName(attribute) === "quoted_attribute_value") attribute = tree.parent(attribute);
  const name = tree.count(attribute) > 0 ? tree.child(attribute, 0) : undefined;
  return name !== undefined && tree.kindName(name) === "attribute_name" && tree.text(name).toLowerCase() === "style";
}

/**
 * Prettier reflows text and collapses the gaps in it, so a text or comment compares by its words; it requotes an
 * attribute value and closes a void element with `/>`, and it lowercases a doctype's `DOCTYPE` and `html`, a known
 * tag's name, and a known attribute's.
 */
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l) => {
    if (l.text === '"' || l.text === "'") return undefined;
    if (l.text === "/>") return ">";
    // A script's or style's content is its own language's to format; the check compares the HTML around it.
    if (tree.kindName(l.node) === "raw_text") return undefined;
    const kind = tree.kindName(l.node);
    // A `style` value prints as css declarations, which lowercase a hex color and write `.5` as `0.5`: compare it
    // with its gaps and `;`s gone, lowercased, each number's leading zero written.
    if (kind === "attribute_value" && isStyleValue(tree, l.node))
      return (
        l.text
          .replaceAll("&quot;", '"')
          .replaceAll(/[\s;]/g, "")
          .replaceAll(/(^|[^\d.])\.(\d)/g, "$10.$2")
          .toLowerCase() || undefined
      );
    const words = l.text.replace(/\s+/g, " ").trim();
    return kind === "doctype" || kind === "tag_name" || kind === "attribute_name" ? words.toLowerCase() : words;
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
export const html: Language<HtmlOptions> = {
  ...base,
  comments: new Set(),
  lineComments: new Map(),
  stream: {
    rules: new Map([
      [
        "document",
        (node, ctx) => {
          const text = ctx.tree.text(node);
          const { printWidth, tabWidth, useTabs, bracketSameLine, singleAttributePerLine, htmlWhitespaceSensitivity } =
            ctx.options;
          const embed = (lang: EmbeddedLanguage, content: string) => {
            const [contentGrammar, formatter] = EMBEDDED[lang];
            const tree = parseTree(contentGrammar, content);
            if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) throw new Unsupported(`${lang} parse error`);
            withEmbedding({ anchor: node, token: undefined }, () =>
              printInto(tree, formatter as unknown as Language<PrettierOptions>, { printWidth, tabWidth, useTabs }),
            );
          };
          const declarations = (value: string) => {
            const tree = parseTree(cssGrammar, `a{${value}}`);
            if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) return undefined;
            const decls = cssBlockDeclarations(tree);
            if (decls === undefined) return undefined;
            const source = `a{${value}}`;
            return decls.map((d, i) => ({
              text: tree.text(d).replace(/;$/, ""),
              blank: i > 0 && /\n[\t\f\r ]*\n/.test(source.slice(tree.end(decls[i - 1] as number), tree.start(d))),
            }));
          };
          const declaration = (decl: string, last: boolean) => {
            const tree = parseTree(cssGrammar, `a{${decl}}`);
            const d = cssBlockDeclarations(tree)?.[0];
            if (d === undefined) throw new Unsupported("style declaration");
            // The css printer ends each declaration with `;`; print/style.js ends the last one with it only broken.
            const token = (s: string, at: number) => {
              // The value sits in double quotes.
              if (s.includes('"')) {
                sText(s.replaceAll('"', "&quot;"));
                return true;
              }
              if (s !== ";" || at !== d) return false;
              if (last) open(IF_BROKEN);
              sText(";");
              if (last) close();
              return true;
            };
            withEmbedding({ anchor: node, token }, () =>
              printInto(tree, css as unknown as Language<PrettierOptions>, { printWidth, tabWidth, useTabs }, d),
            );
          };
          const atFileStart = ctx.tree.lf(node) === 0 && ctx.tree.col(node) === 0;
          printHtml(parseHtml(text, true, atFileStart, htmlWhitespaceSensitivity), text, {
            text: sText,
            tabWidth,
            bracketSameLine,
            singleAttributePerLine,
            embed,
            declarations,
            declaration,
          });
        },
      ],
    ]),
    lists: new Set(),
    finalLine: () => true,
  },
};
