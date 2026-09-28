import { NO_NODE, type Tree } from "../../core/arena.js";
import { decimalValue, type Normalize } from "../../fmt/check.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { sToken } from "../../fmt/stream.js";
import { maybeLower, numberParts } from "../../fmt/dsl/normalizers.js";
import type { CustomRule, PredicateRule } from "../../fmt/dsl/runtime.js";
import type { StreamCtx, StreamRule } from "../../fmt/stream-format.js";
import type { FormatTree } from "../../fmt/tree.js";
import { grammar } from "./bundle.js";
import * as gen from "./fmt.gen.js";
import { language } from "./index.js";

/** The prettier options its postcss printer reads (3.9.9); `bracketSpacing` and `objectWrap` go unread. */
export interface CssOptions extends PrettierOptions {
  singleQuote: boolean;
}

const defaults: CssOptions = { ...prettierDefaults, singleQuote: false };

type SCtx = StreamCtx<CssOptions>;
type SRule = StreamRule<CssOptions>;

const src = (n: number, ctx: SCtx) => ctx.tree.text(n);
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
const childOfKind = (n: number, k: string, ctx: SCtx) =>
  children(n, ctx.tree).find((c) => kind(c, ctx) === k);

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

const within = (n: number, k: string, ctx: SCtx) => {
  const p = ctx.tree.parent(n);
  return p !== NO_NODE && kind(p, ctx) === k;
};
/** An `an+b` argument, which postcss-selector-parser reads as `an + b` (the `+` a combinator). */
function nthArgument(n: number, ctx: SCtx): boolean {
  if (!within(n, "arguments", ctx)) return false;
  const pseudo = ctx.tree.parent(ctx.tree.parent(n));
  if (pseudo === NO_NODE) return false;
  const name = childOfKind(pseudo, "class_name", ctx);
  return name !== undefined && /^nth-/i.test(src(name, ctx));
}
/** The name of the nearest function around `n`, lowercased, as prettier's `insideValueFunctionNode` asks. */
function enclosingFunction(n: number, ctx: SCtx): string | undefined {
  for (let p = ctx.tree.parent(n); p !== NO_NODE; p = ctx.tree.parent(p)) {
    const k = kind(p, ctx);
    if (k === "call_expression") {
      const name = childOfKind(p, "function_name", ctx);
      return name === undefined ? undefined : src(name, ctx).toLowerCase();
    }
    if (k === "declaration" || k === "block") return undefined;
  }
  return undefined;
}

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
      return parentKind === "pseudo_class_selector" ? t.toLowerCase() : t;
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

// ---- the rules format.ts names as `custom`: prettier's heuristics, and the leaves it respells ----

const respell =
  (f: (t: string, node: number, ctx: SCtx) => string): SRule =>
  (node, ctx) =>
    sToken(node, f(src(node, ctx), node, ctx));

/** The rules `custom` names in format.ts. */
export const customs = {
  plainValue: respell((t, node, ctx) => {
    if (within(node, "attribute_selector", ctx)) {
      const q = ctx.options.singleQuote ? "'" : '"';
      return /["']/.test(t) ? t : q + t + q;
    }
    if (nthArgument(node, ctx))
      return t.replace(/(?<=[^\s+-])\+(?=\S)/g, " + ");
    return cssWideKeywords.has(t.toLowerCase()) ? t.toLowerCase() : t;
  }),
  /** Prettier indents a selector of more than two nodes as it breaks. */
  longSelector: (node, ctx) => parts(node, ctx) > 2,
  /** A `url()` function's arguments, which prettier prints as written. */
  urlArguments: (node, ctx) => {
    if (!within(node, "call_expression", ctx)) return false;
    const name = childOfKind(ctx.tree.parent(node), "function_name", ctx);
    return name !== undefined && src(name, ctx).toLowerCase() === "url";
  },
  inCalc: (node, ctx) => enclosingFunction(node, ctx) === "calc",
} satisfies Record<string, CustomRule<CssOptions> | PredicateRule<CssOptions>>;

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
  stream: gen.css(customs),
};
