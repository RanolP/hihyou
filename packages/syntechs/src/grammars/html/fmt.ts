import { parseTree } from "../../core/index.js";
import type { Language as Grammar } from "../../core/language.js";
import type { Normalize } from "../../fmt/check.js";
import { directive } from "../../fmt/dsl/normalizers.js";
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
import { EVENT_HANDLERS, type EmbeddedLanguage, parseHtml, printHtml, Unsupported, type WhitespaceSensitivity } from "./print.js";

/** Each language a script or style holds: the grammar its content parses with and the formatter printing it. */
const EMBEDDED: Record<EmbeddedLanguage, [Grammar, unknown]> = {
  babel: [jsGrammar, javascript],
  typescript: [tsGrammar, typescript],
  tsx: [tsxGrammar, tsx],
  json: [jsGrammar, json],
  css: [cssGrammar, css],
};

const LEGACY_MARK = "//\u{E000}";

/** Each `<!--` or `-->` comment's offsets in a parsed script. */
function htmlComments(tree: ReturnType<typeof parseTree>): [number, number][] {
  const found: [number, number][] = [];
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if (tree.kindName(n) === "html_comment") found.push([tree.start(n), tree.end(n)]);
  }
  return found.sort((a, b) => a[0] - b[0]);
}

export interface HtmlOptions extends PrettierOptions {
  bracketSameLine: boolean;
  singleAttributePerLine: boolean;
  htmlWhitespaceSensitivity: WhitespaceSensitivity;
  /** The JS formatter's `semi`, for an `on*` value. */
  semi: boolean;
  embeddedLanguageFormatting: "auto" | "off";
}

const defaults: HtmlOptions = {
  ...prettierDefaults,
  bracketSameLine: false,
  singleAttributePerLine: false,
  htmlWhitespaceSensitivity: "css",
  semi: true,
  embeddedLanguageFormatting: "auto",
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

function isValueOf(tree: ReturnType<typeof parseTree>, value: number, attributeName: string): boolean {
  let attribute = tree.parent(value);
  if (tree.kindName(attribute) === "quoted_attribute_value") attribute = tree.parent(attribute);
  const name = tree.count(attribute) > 0 ? tree.child(attribute, 0) : undefined;
  return (
    name !== undefined && tree.kindName(name) === "attribute_name" && tree.text(name).toLowerCase() === attributeName
  );
}

function isEventHandlerValue(tree: ReturnType<typeof parseTree>, value: number): boolean {
  let attribute = tree.parent(value);
  if (tree.kindName(attribute) === "quoted_attribute_value") attribute = tree.parent(attribute);
  const name = tree.count(attribute) > 0 ? tree.child(attribute, 0) : undefined;
  return name !== undefined && tree.kindName(name) === "attribute_name" && EVENT_HANDLERS.has(tree.text(name));
}

// The HTML spec's elements whose end tag may be omitted (13.1.2.4 Optional tags).
const OPTIONAL_END_TAGS = new Set([
  "html", "head", "body", "li", "dt", "dd", "p", "rt", "rp", "optgroup", "option",
  "caption", "colgroup", "thead", "tbody", "tfoot", "tr", "td", "th",
]);

/**
 * Prettier reflows text and collapses the gaps in it, so a text or comment compares by its words; it requotes an
 * attribute value and closes a void element with `/>`, and it lowercases a doctype's `DOCTYPE` and `html`, a known
 * tag's name, and a known attribute's.
 */
const normalize: Normalize = (lexemes, text, tree) =>
  lexemes.map((l) => {
    if (l.text === '"' || l.text === "'") return undefined;
    // Prettier writes the end tag an element was closed without: one HTML lets a page omit, or one the end of
    // the file closes. Neither changes what the page means, so neither compares.
    const endTag = tree.kindName(l.node) === "end_tag" ? l.node : tree.parent(l.node);
    if (tree.kindName(endTag) === "end_tag") {
      const name = /^<\/([^\s>]*)/.exec(tree.text(endTag))?.[1]?.toLowerCase() ?? "";
      if (OPTIONAL_END_TAGS.has(name) || /^(\s*<\/[^>]*>)*\s*$/.test(text.slice(tree.end(endTag)))) return undefined;
    }
    if (l.text === "/>") return ">";
    // A script's or style's content is its own language's to format; the check compares the HTML around it.
    if (tree.kindName(l.node) === "raw_text") return undefined;
    const kind = tree.kindName(l.node);
    // An `on*` value is JS, its own language's to format, as a script's content is.
    if (kind === "attribute_value" && isEventHandlerValue(tree, l.node)) return undefined;
    // A `style` value prints as css declarations, which lowercase a hex color and write `.5` as `0.5`: compare it
    // with its gaps and `;`s gone, lowercased, each number's leading zero written.
    // An `allow` value prints as its directives, each ending in a `;` only broken: compare it with its gaps and `;`s gone.
    if (kind === "attribute_value" && isValueOf(tree, l.node, "allow")) return l.text.replaceAll(/[\s;]/g, "") || undefined;
    // A `srcset` value prints as its candidates, aligned when broken: compare it with its gaps gone.
    if (kind === "attribute_value" && isValueOf(tree, l.node, "srcset")) return l.text.replaceAll(/\s/g, "") || undefined;
    if (kind === "attribute_value" && isValueOf(tree, l.node, "style"))
      return (
        l.text
          .replaceAll("&quot;", '"')
          .replaceAll(/[\s;]/g, "")
          .replaceAll(/(^|[^\d.])\.(\d)/g, "$10.$2")
          .toLowerCase() || undefined
      );
    // A conditional comment's content prints as HTML: compare it with its gaps and quotes gone, a void tag's `/>` as `>`.
    if (kind === "comment" && /^<!--\[if[^\]]*\]>/.test(l.text))
      return l.text.replaceAll(/[\s"']/g, "").replaceAll("/>", ">");
    const words = l.text.replace(/\s+/g, " ").trim();
    // A requoted value writes its quotes as `&quot;` or `&apos;` or bare, whichever the new quote needs.
    if (kind === "attribute_value") return words.replaceAll("&apos;", "'").replaceAll("&quot;", '"');
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
            let tree = parseTree(contentGrammar, content);
            if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) throw new Unsupported(`${lang} parse error`);
            // A legacy `<!--` or `-->` line is a comment to babel, printed as written; the JS formatter leaves an
            // html_comment out, so it goes through as a `//` comment marked to print without its `//`.
            const legacy = htmlComments(tree);
            if (legacy.length > 0) {
              let rewritten = content;
              for (const [start, end] of legacy.reverse())
                rewritten = `${rewritten.slice(0, start)}${LEGACY_MARK}${rewritten.slice(start, end).trimEnd()}${rewritten.slice(end)}`;
              tree = parseTree(contentGrammar, rewritten);
              if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) throw new Unsupported(`${lang} parse error`);
            }
            const token =
              legacy.length === 0
                ? undefined
                : (s: string) => {
                    if (!s.startsWith(LEGACY_MARK)) return false;
                    sText(s.slice(LEGACY_MARK.length));
                    return true;
                  };
            withEmbedding({ anchor: node, token }, () =>
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
          // An inline event handler is a babel program in single quotes; its `;` is left off when the program is
          // one expression statement, `onclick="f()"`.
          const eventHandler = (code: string) => {
            const tree = parseTree(jsGrammar, code);
            if (tree.errorChars > 0 || brokenNodes(tree) !== undefined) return undefined;
            const statements: number[] = [];
            for (let i = 0; i < tree.count(tree.root); i++) {
              const c = tree.child(tree.root, i);
              if (tree.kindName(c) !== "comment") statements.push(c);
            }
            const only = statements.length === 1 ? statements[0] : undefined;
            const bare = only !== undefined && tree.kindName(only) === "expression_statement" ? only : undefined;
            // A directive keeps prettier's own quote preference, double, where a string literal takes single.
            const directives = new Set<number>();
            for (const s of statements) {
              const str = tree.kindName(s) === "expression_statement" && tree.count(s) > 0 ? tree.child(s, 0) : undefined;
              if (str === undefined || tree.kindName(str) !== "string") break;
              directives.add(str);
            }
            const token = (s: string, at: number) => {
              if (s === ";" && bare !== undefined && (at === bare || tree.parent(at) === bare)) return true;
              if (directives.has(at)) {
                sText(directive(tree.text(at), { singleQuote: false }).replaceAll('"', "&quot;"));
                return true;
              }
              // The value sits in double quotes.
              if (!s.includes('"')) return false;
              sText(s.replaceAll('"', "&quot;"));
              return true;
            };
            return () =>
              withEmbedding({ anchor: node, token }, () =>
                printInto(tree, javascript as unknown as Language<PrettierOptions & { singleQuote: boolean; semi: boolean }>, {
                  printWidth,
                  tabWidth,
                  useTabs,
                  semi: ctx.options.semi,
                  singleQuote: true,
                }),
              );
          };
          const atFileStart =ctx.tree.lf(node) === 0 && ctx.tree.col(node) === 0;
          const embeddedOff = ctx.options.embeddedLanguageFormatting === "off";
          printHtml(parseHtml(text, true, atFileStart, htmlWhitespaceSensitivity, embeddedOff), text, {
            embeddedOff,
            text: sText,
            tabWidth,
            bracketSameLine,
            singleAttributePerLine,
            embed,
            declarations,
            declaration,
            eventHandler,
          });
        },
      ],
    ]),
    lists: new Set(),
    // A blank file prints as "".
    finalLine: ({ tree }) => tree.count(tree.root) > 0,
  },
};
