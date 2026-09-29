import { NO_NODE, type Tree } from "../../core/arena.js";
import { decimalValue, type Normalize } from "../../fmt/check.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { maybeLower, numberParts } from "../../fmt/dsl/normalizers.js";
import { ancestorWhere, firstTextIs, parentIs, type PredicateRule } from "../../fmt/dsl/runtime.js";
import { close, FILL, FILL_ITEM, GROUP, INDENT, open, sHardline, sLine, sText, sToken } from "../../fmt/stream.js";
import type { StreamCtx } from "../../fmt/stream-format.js";
import type { FormatTree } from "../../fmt/tree.js";
import { grammar } from "./bundle.js";
import * as gen from "./fmt.gen.js";
import { directives } from "./directive.js";
import { frontMatterLines, parseFrontMatter } from "./front-matter.js";
import { language } from "./index.js";

/** The prettier options its postcss printer reads (3.9.9); `bracketSpacing` and `objectWrap` go unread. */
export interface CssOptions extends PrettierOptions {
  singleQuote: boolean;
  /** `off` prints front matter as written; `auto` lays YAML's out (see `frontMatterLines`). */
  embeddedLanguageFormatting: "auto" | "off";
}

const defaults: CssOptions = {
  ...prettierDefaults,
  singleQuote: false,
  embeddedLanguageFormatting: "auto",
};

type SCtx = StreamCtx<CssOptions>;

const kind = (n: number, ctx: SCtx) => ctx.tree.kindName(n);
const children = (n: number, tree: FormatTree) => {
  const out: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++)
    out.push(tree.child(n, i));
  return out;
};
const isComment = (n: number, ctx: SCtx) =>
  kind(n, ctx) === "comment" || kind(n, ctx) === "js_comment";
/** Every child but comments, which reach the output attached to their neighbours. */
const code = (n: number, ctx: SCtx) =>
  children(n, ctx.tree).filter((c) => !isComment(c, ctx));

const cssWideKeywords = new Set(["initial", "inherit", "unset", "revert"]);

// A CSS string's value: its escapes resolved (css-syntax-3 §4.3.7), so a requoted string compares equal.
const cook = (quoted: string) =>
  quoted
    .slice(1, -1)
    .replace(
      /\\(?:\r\n|[\n\r\f])|\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|\\([\s\S])/g,
      (_, hex: string | undefined, ch: string | undefined) => {
        if (hex === undefined) return ch ?? "";
        const cp = Number.parseInt(hex, 16);
        return String.fromCodePoint(cp > 0x10ffff || cp === 0 ? 0xfffd : cp);
      },
    );

// What a token means, whatever prettier's spelling of it: a string by its cooked value, a number by its exact
// value and its unit, and hex colors, keywords and names by their case-folded form where CSS ignores case.
function meaning(tree: Tree, node: number, t: string): string {
  const parent = tree.parent(node);
  const parentKind = parent === NO_NODE ? undefined : tree.kindName(parent);
  switch (tree.kindName(node)) {
    case "string_value":
      return cook(t);
    case "integer_value":
    case "float_value": {
      const m = numberParts.exec(t);
      if (!m) return t;
      const [, num = "", unit = "", rest = ""] = m;
      return `${decimalValue(num) ?? num}${unit.toLowerCase()}${rest}`;
    }
    case "color_value":
    case "feature_name":
    case "at_keyword":
    case "from":
    case "to":
      return t.toLowerCase();
    case "property_name":
      return maybeLower(t);
    case "class_name":
      return parentKind === "pseudo_class_selector" ? maybeLower(t) : t;
    case "tag_name":
      return parentKind === "pseudo_element_selector" ? t.toLowerCase() : t;
    case "plain_value":
      if (parentKind === "attribute_selector")
        return /^["']/.test(t) ? cook(t) : t;
      return cssWideKeywords.has(t.toLowerCase())
        ? t.toLowerCase()
        : t.replace(/\s+/g, "");
    default:
      return !tree.named(node) && t.startsWith("@") ? t.toLowerCase() : t;
  }
}

// A `;` that ends the last statement of a block or of the file means nothing, so prettier may add one there.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    const next = lexemes[i + 1]?.text;
    if (l.text === ";" && (next === undefined || next === "}"))
      return undefined;
    return meaning(tree, l.node, l.text);
  });

const statementLists = new Set(["stylesheet", "block"]);

const combinators = new Set([
  "child_selector",
  "descendant_selector",
  "sibling_selector",
  "adjacent_sibling_selector",
]);
/**
 * How many nodes postcss-selector-parser gives the selector: each simple selector and each combinator. Tree-sitter
 * nests a compound `a.b:c` leftwards, so the part left of the first punctuation is the rest of the compound.
 */
function parts(n: number, ctx: SCtx): number {
  const kids = code(n, ctx);
  const named = (c: number | undefined) => c !== undefined && ctx.tree.named(c);
  if (combinators.has(kind(n, ctx)))
    return kids.reduce((sum, c) => sum + (named(c) ? parts(c, ctx) : 0), 1);
  const left = kids[0];
  const second = kids[1];
  return left !== undefined &&
    named(left) &&
    second !== undefined &&
    !named(second) &&
    kind(n, ctx).endsWith("_selector")
    ? parts(left, ctx) + 1
    : 1;
}

/** The rules `when` names in format.ts. */
export const customs = {
  /** Prettier indents a selector of more than two nodes as it breaks. */
  longSelector: (node, ctx) => parts(node, ctx) > 2,
} satisfies Record<string, PredicateRule<CssOptions>>;

/** A binary expression's `/` written with no gap on either side, which prettier keeps so. */
function tightDivision(node: number, ctx: SCtx): boolean {
  const [left, op, right] = children(node, ctx.tree);
  return (
    op !== undefined &&
    kind(op, ctx) === "/" &&
    ctx.tree.adjoins(left as number, op) &&
    ctx.tree.adjoins(op, right as number)
  );
}

const operators = new Set(["+", "-", "*", "/"]);

/**
 * Prettier's math in a value, which postcss-value-parser reads as a flat run of words and operators where the
 * grammar nests it leftwards: so the outermost expression lays the chain out, the inner ones adding only their
 * operands and operators. In a value, an operator follows its left operand after a space and the right operand
 * follows it after a line, all packed in one fill (printCommaSeparatedValueGroup's `indent(fill(...))`); an
 * operator written without a gap stays joined, but inside `calc()` every one is spaced. In a Sass directive's
 * prelude the chain is one group instead, a `/` written without gaps staying so.
 */
export function valueMath(node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const outermost = !parentIs(t, node, "binary_expression");
  const directive = ancestorWhere(t, node, ["at_rule", "postcss_statement"], ["block"], (a) =>
    firstTextIs(ctx, a, undefined, directives, [], false),
  );
  const calc =
    !directive &&
    ancestorWhere(t, node, ["call_expression"], ["declaration", "block"], (a) =>
      firstTextIs(ctx, a, undefined, ["calc"], [], true),
    );
  const tight = directive && tightDivision(node, ctx);
  if (outermost) {
    open(GROUP);
    open(INDENT);
    if (!directive) {
      open(FILL);
      open(FILL_ITEM);
    }
  }
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    if (prev !== -1 && !tight && (directive || calc || !t.adjoins(prev, c))) {
      if (operators.has(kind(c, ctx))) sText(" ");
      else if (directive) sLine(0);
      else {
        close();
        sLine(0);
        open(FILL_ITEM);
      }
    }
    prev = c;
    if (named) ctx.print(c);
    else sToken(c, t.text(c));
  }
  if (outermost) {
    if (!directive) {
      close();
      close();
    }
    close();
    close();
  }
}

/**
 * Prettier's printNodeSequence: a statement whose previous sibling is a `/* prettier-ignore *\/` comment prints as
 * written. Ordinals run in postorder, so the node just before `node`'s leftmost leaf is its previous sibling.
 */
export function prettierIgnored(node: number, ctx: SCtx): boolean {
  const { tree } = ctx;
  const parent = tree.parent(node);
  if (parent === NO_NODE || !statementLists.has(kind(parent, ctx))) return false;
  let first = node;
  while (tree.count(first) > 0) first = tree.child(first, 0);
  const ord = tree.ord(first);
  if (ord === 0) return false;
  const prev = tree.at(ord - 1);
  return (
    kind(prev, ctx) === "comment" &&
    tree.parent(prev) === tree.parent(node) &&
    /^\/\*\s*prettier-ignore\s*\*\/$/.test(tree.text(prev))
  );
}

/** Prettier's css-root: the front matter, then a blank line before the stylesheet unless it is empty. */
export function frontMatterFirst(
  node: number,
  ctx: SCtx,
  print: () => void,
): void {
  const fm =
    node === ctx.tree.root ? parseFrontMatter(ctx.tree.frontMatter) : undefined;
  if (fm) {
    frontMatterLines(
      fm,
      ctx.options.embeddedLanguageFormatting !== "off",
    ).forEach((line, i) => {
      if (i > 0) sHardline();
      sText(line);
    });
    sHardline();
    if (ctx.tree.count(node) > 0) sHardline();
  }
  print();
}

/** CSS as prettier 3.9.9's postcss printer lays it out; the layouts are format.ts, generated into fmt.gen.ts. */
export const css: Language<CssOptions> = {
  ...defineLanguage(grammar, {
    parser: language,
    // What `meaning` reads whole: a string's quotes and escapes, and a name's identifier, are separate leaves.
    atoms: ["string_value", "class_name", "plain_value", "color_value"],
    lineComments: { js_comment: "//" },
    defaults,
    settings: prettierSettings,
    normalize,
    layoutBlind: true,
  }),
  stream: {
    ...gen.css({ ...customs, valueMath }),
    wrap: frontMatterFirst,
    keepsSource: prettierIgnored,
  },
};
