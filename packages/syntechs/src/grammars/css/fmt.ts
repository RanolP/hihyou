import { NO_NODE, type Tree } from "../../core/arena.js";
import { decimalValue, type Normalize } from "../../fmt/check.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import type { CommentHandler } from "../../fmt/comments.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { atName, maybeLower, numberParts, unitCase } from "../../fmt/dsl/normalizers.js";
import {
  ancestorWhere,
  breaksBetween,
  firstTextIs,
  parentIs,
  type PredicateRule,
  type SplitEntry,
  splitRun,
} from "../../fmt/dsl/runtime.js";
import {
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  INDENT,
  open,
  SOFT,
  sHardline,
  sLine,
  sLiteral,
  sText,
  sToken,
} from "../../fmt/stream.js";
import { nextLineEmpty } from "../../fmt/text.js";
import {
  printLeadingComments,
  printTrailingComments,
  type StreamCtx,
  type StreamRule,
} from "../../fmt/stream-format.js";
import { firstLeaf, type FormatTree, nextLeaf, prevLeaf } from "../../fmt/tree.js";
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
const isComment = (n: number, ctx: SCtx) => kind(n, ctx) === "comment";
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
    case "important":
      return "!important";
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

/**
 * A function's last `,` (`f(a,)`, also before a comment), which oxc-css-parser drops with the empty argument after it, but in
 * `var()`, whose fallback it keeps as written, and in `url()`, one word.
 */
function droppedComma(tree: Tree, node: number): boolean {
  if (tree.named(node) || tree.kindName(node) !== ",") return false;
  const args = tree.parent(node);
  if (args === NO_NODE || tree.kindName(args) !== "arguments") return false;
  const call = tree.parent(args);
  if (call === NO_NODE || tree.kindName(call) !== "call_expression") return false;
  if (["var", "url"].includes(tree.text(tree.child(call, 0)).toLowerCase())) return false;
  let i = 0;
  while (tree.child(args, i) !== node) i++;
  for (let j = i + 1, count = tree.count(args); j < count; j++) {
    const c = tree.child(args, j);
    if (tree.kindName(c) !== "comment") return tree.kindName(c) === ")";
  }
  return false;
}

// A `;` that ends the last statement of a block or of the file means nothing, so prettier may add one there; nor
// does an empty statement's (`a: b;;`), which postcss drops. A sign before a number means the signed number, which
// prettier may join to it (`+ 20px` is `+20px`) or part from it.
const normalize: Normalize = (lexemes, _text, tree) => {
  const isNumber = (i: number) => {
    const l = lexemes[i];
    return l !== undefined && ["integer_value", "float_value"].includes(tree.kindName(l.node));
  };
  const sign = (i: number) => {
    const l = lexemes[i];
    if (l === undefined || (l.text !== "+" && l.text !== "-") || !isNumber(i + 1)) return false;
    const parent = tree.parent(l.node);
    if (parent === NO_NODE) return false;
    if (tree.kindName(parent) === "unary_expression") return true;
    // `round(1) +2`, which prettier prints `round(1) + 2` (`number`).
    return (
      l.text === "+" &&
      tree.kindName(parent) === "binary_expression" &&
      tree.kindName(tree.child(parent, 0)) === "call_expression"
    );
  };
  const forms = lexemes.map((l, i) => {
    const next = lexemes[i + 1]?.text;
    const prev = lexemes[i - 1]?.text;
    if (l.text === ";" && (next === undefined || next === "}" || next === ";" || prev === "{"))
      return undefined;
    if (sign(i) || tree.kindName(l.node) === "trailing_comma" || droppedComma(tree, l.node)) return undefined;
    if (sign(i - 1)) return meaning(tree, l.node, `${prev}${l.text}`);
    return meaning(tree, l.node, l.text);
  });
  // `a*b`, one word to tree-sitter, is three tokens to oxc-css-parser, which prints `a * b` (`colonThenRawTokens`):
  // a value's `*` and `/` join the words around them into one form.
  const inValue = (node: number) => {
    for (let up = tree.parent(node); up !== NO_NODE; up = tree.parent(up))
      if (tree.kindName(up) === "declaration") return true;
    return false;
  };
  // Likewise a `#name` or `$name` glued to the word before it (`a#b`), which oxc prints apart (`plainWord`).
  for (let i = 1, p = 0; i < lexemes.length; i++) {
    const l = lexemes[i] as (typeof lexemes)[number];
    const prev = forms[p];
    if (/^[#$]/.test(l.text) && prev !== undefined && /[\w%)]$/.test(prev) && inValue(l.node)) {
      forms[p] = `${prev}${forms[i]}`;
      forms[i] = undefined;
    } else if (forms[i] !== undefined) p = i;
  }
  // A word ending in `*` before another (`a* b`), which oxc prints `a * b`.
  for (let i = 0; i + 1 < lexemes.length; i++) {
    const l = lexemes[i] as (typeof lexemes)[number];
    const next = forms[i + 1];
    if (l.text.length > 1 && l.text.endsWith("*") && next !== undefined && /^[\w#$.-]/.test(next) && inValue(l.node)) {
      forms[i + 1] = `${forms[i]}${next}`;
      forms[i] = undefined;
    }
  }
  for (let i = 1; i + 1 < lexemes.length; i++) {
    const l = lexemes[i] as (typeof lexemes)[number];
    if ((l.text !== "*" && l.text !== "/") || forms[i] === undefined || !inValue(l.node)) continue;
    let p = i - 1;
    while (p > 0 && forms[p] === undefined) p--;
    if (forms[p] === undefined) continue;
    // `a*` ending a word: oxc prints `a *`.
    if (l.text === "*" && !/^[\w#$.-]/.test(lexemes[i + 1]?.text ?? "")) {
      forms[p] = `${forms[p]}*`;
      forms[i] = undefined;
      continue;
    }
    if (forms[i + 1] === undefined) continue;
    forms[p] = `${forms[p]}${l.text}${forms[i + 1]}`;
    forms[i] = forms[i + 1] = undefined;
  }
  return forms;
};

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

/**
 * A word the grammar reads whole but CSS Syntax lexes as an ident then more tokens (`a/c`, `a*1`, `a%c`), but a
 * unicode range (`U+0025-00FF`), one token to oxc-css-parser.
 */
const identThenMore = (n: number, ctx: SCtx) =>
  kind(n, ctx) === "plain_value" &&
  !/^u\+[\da-f?]/i.test(ctx.tree.text(n)) &&
  new RegExp(String.raw`^-?(?:-|${nameStart})${nameChar}*(?!${nameChar})[^]`).test(ctx.tree.text(n));

/** A word CSS Syntax lexes as one ident opening with a single `-` (`-b`, `-webkit-box`), which oxc breaks the list at. */
const dashIdent = (n: number, ctx: SCtx) =>
  kind(n, ctx) === "plain_value" && new RegExp(String.raw`^-${nameStart}${nameChar}*$`).test(ctx.tree.text(n));

/** The rules `when` names in format.ts. */
export const customs = {
  /** Prettier indents a selector of more than two nodes as it breaks. */
  longSelector: (node, ctx) => parts(node, ctx) > 2,
  /** A declaration with nothing between its `:` and its `;` (`--empty:;`). */
  emptyValue: (node, ctx) => code(node, ctx).every((c) => !ctx.tree.named(c) || kind(c, ctx) === "property_name"),
  unparsedValue: (node, ctx) => unparsedUrl(node, ctx) || rawValue(node, ctx),
  /** A normal property's value oxc-css-parser reads as raw tokens (`oxcRaw`), which `colonThenRawTokens` prints. */
  rawTokens: (node, ctx) => !customName(node, ctx.tree) && oxcRaw(node, ctx.tree),
  /** A media query list holding a comment, which `mediaQueries` prints as postcss-media-query-parser splits it. */
  mediaComments: (node, ctx) => mediaAtoms(node, ctx).some((c) => isComment(c, ctx)),
  ownWord: (node, ctx) => ownWord(node, ctx),
  /**
   * A declaration's comma entry that is one math expression (`a / c`, `// c`) or a lone `!word`, which oxc-css-parser
   * reads as several values, so a list holding one breaks as one of several words does; so does an entry of comments
   * alone (`a,/*c*\/,b`).
   */
  mathEntry: (node, ctx) =>
    commentEntry(node, ctx) ||
    code(node, ctx).some(
      (c, i, all) =>
        (["binary_expression", "unary_expression", "important_value"].includes(kind(c, ctx)) ||
          identThenMore(c, ctx) ||
          (dashIdent(c, ctx) && all.slice(0, i).some((p) => kind(p, ctx) === ","))) &&
        ![all[i - 1], all[i + 1]].some(
          (n) => n !== undefined && ctx.tree.named(n) && !["property_name", "important"].includes(kind(n, ctx)),
        ),
    ),
} satisfies Record<string, PredicateRule<CssOptions>>;

/** Whether a declaration's comma list holds an entry of comments alone between two commas. */
function commentEntry(node: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  const commas = children(node, t).filter((c) => t.text(c) === ",");
  return ctx.danglingComments(node).some((d) => {
    const prev = prevLeaf(t, d);
    const next = nextLeaf(t, d);
    return commas.includes(prev) && commas.includes(next);
  });
}

/**
 * A value item written joined to a function on either side, which postcss-value-parser still reads as a node of its
 * own and prettier prints after a line (`"("attr(title)")"` is `"(" attr(title) ")"`), but a word after a `$$(...)`
 * (postcss-simple-vars' `$$(style)Color`), which prettier keeps joined.
 */
function ownWord(node: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  const siblings = children(t.parent(node), t);
  const prev = siblings[siblings.indexOf(node) - 1];
  if (prev === undefined || !t.adjoins(prev, node)) return false;
  // A number, a word, a `!word` or a function joined to a function before it stays joined (`f(1)-2`, `f(1)f(2)`, `f(1)!c`).
  if (
    kind(prev, ctx) === "call_expression" &&
    ["call_expression", "plain_value", "integer_value", "float_value", "important_value"].includes(kind(node, ctx))
  )
    return false;
  if (kind(node, ctx) === "call_expression") return true;
  // `1#b`, `1$b`: oxc lexes the `#b` or `$b` after a number as a token of its own.
  if (
    ["hash_value", "color_value"].includes(kind(node, ctx)) ||
    (kind(node, ctx) === "plain_value" && t.text(node).startsWith("$"))
  )
    return ["integer_value", "float_value"].includes(kind(prev, ctx));
  if (kind(prev, ctx) !== "call_expression") return false;
  return kind(node, ctx) !== "plain_value" || t.text(t.child(prev, 0)) !== "$$";
}

const verbatimCall = (name: string) => name.toLowerCase() === "url" || mathFunctions.has(name.toLowerCase());

/**
 * A word outside a math function (whose calc grammar reads `a*c` whole) or `url(…)`, and holding no
 * `=` or `:` (`progid:`), spaced where CSS Syntax lexes it as several tokens oxc separates: a `*` apart from
 * both sides but after an ident ending in `-` (Tailwind's `w-*`) or ending the word, and a `#name` or `$name` apart
 * from the word before it.
 */
function plainWord(node: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  const text = t.text(node);
  if (!/[*#$]/.test(text) || /[=:]/.test(text) || cssWideKeywords.has(text.toLowerCase())) return false;
  let up = t.parent(node);
  for (; up !== NO_NODE && kind(up, ctx) !== "declaration"; up = t.parent(up))
    if (kind(up, ctx) === "call_expression" && verbatimCall(t.text(t.child(up, 0)))) return false;
  if (up === NO_NODE) return false;
  sLiteral(
    node,
    text
      .replace(/\*/g, (m, i: number) => (text[i - 1] === "-" ? m : ` ${m} `))
      .replace(new RegExp(String.raw`(?<=[\w%)])(?=[#$]${nameChar})`, "g"), " ")
      .replace(/ {2,}/g, " ")
      .trim(),
  );
  return true;
}

/** A number, its unit's case normalized. */
export function number(node: number, ctx: SCtx): void {
  sLiteral(node, unitCase(ctx.tree.text(node)));
}

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
const isOperator = (n: number | undefined, ctx: SCtx) => n !== undefined && operators.has(kind(n, ctx));

/** The operands and operators of the math chain whose outermost expression is `node`, in source order. */
function chain(node: number, ctx: SCtx): number[] {
  const items = new Set(ctx.items(node));
  return children(node, ctx.tree).flatMap((c) =>
    ctx.tree.named(c) && !items.has(c) ? [] : kind(c, ctx) === "binary_expression" ? chain(c, ctx) : [c],
  );
}

/** A postcss-value-parser function or word, which spaces an operator next to it. */
const funcOrWord = (n: number | undefined, ctx: SCtx) =>
  n !== undefined && ["call_expression", "plain_value", "color_value"].includes(kind(n, ctx));
/** What a `font` value's `/` stays joined to: a number, or a math or custom function. */
const fontOperand = (n: number | undefined, ctx: SCtx) =>
  n !== undefined &&
  (kind(n, ctx) === "integer_value" ||
    kind(n, ctx) === "float_value" ||
    (kind(n, ctx) === "call_expression" &&
      firstTextIs(ctx, n, undefined, ["var", "calc", "min", "max", "clamp"], ["--"], true)));

/** Whether the math chain holding `n` is a paren group's. */
const inParens = (n: number, t: FormatTree): boolean => {
  let top = t.parent(n);
  while (parentIs(t, top, "binary_expression")) top = t.parent(top);
  return parentIs(t, top, "parenthesized_value");
};

/**
 * Whether prettier's printCommaSeparatedValueGroup joins the neighbours `chain[i - 1]` and `chain[i]` of a math chain.
 * Outside `calc()`, a `/` or `+` written without a gap before its right side stays joined unless a function or a word
 * sits beside it, and a `-` so written always; a `*` is always spaced. In `font` and custom properties, a `/` written
 * without a gap after a number or a math function stays joined, and so does what follows it, even inside `calc()`.
 * Inside `calc()` every operator stays joined on a side written without a gap. A `+` beside a function or a word
 * stays joined too; a `/` there, outside a paren group, stays joined only when written without a gap on both sides;
 * and a paren group joined to its `+` or `-` stays so.
 */
function joinedMath(chain: number[], i: number, calc: boolean, font: boolean, ctx: SCtx): boolean {
  const t = ctx.tree;
  const [y, g, v, w] = [chain[i - 2], chain[i - 1] as number, chain[i] as number, chain[i + 1]];
  const op = (n: number | undefined, o: string) => n !== undefined && kind(n, ctx) === o;
  const tight = t.adjoins(g, v);
  // Inside `calc()`, an operator stays joined to what the source writes it against (`calc(100%- 2px)`).
  if (calc && tight) return true;
  // Whether a function or a word `beside` the operator `o` spaces it; `otherTight`: `o`'s other side has no gap.
  const spacedBy = (o: number, otherTight: boolean, beside: boolean) =>
    beside && op(o, "/") && (inParens(o, t) || !otherTight);
  if (isOperator(v, ctx)) {
    if (font && op(v, "/") && tight && fontOperand(g, ctx)) return true;
    const spaced = spacedBy(v, w !== undefined && t.adjoins(v, w), funcOrWord(w, ctx) || funcOrWord(g, ctx));
    return !calc && tight && (op(v, "-") || ((op(v, "/") || op(v, "+")) && !spaced));
  }
  if (font && op(g, "/") && y !== undefined && t.adjoins(y, g) && fontOperand(y, ctx)) return true;
  const spaced = spacedBy(g, y !== undefined && t.adjoins(y, g), funcOrWord(v, ctx) || funcOrWord(y, ctx));
  return !calc && tight && (op(g, "-") || ((op(g, "/") || op(g, "+")) && !spaced));
}

/** A `/` before an operand (`// c`), which tree-sitter-css nests where oxc-css-parser reads two `/` delimiters. */
const slashUnary = (n: number, ctx: SCtx) =>
  kind(n, ctx) === "unary_expression" && kind(ctx.tree.child(n, 0), ctx) === "/";

/** The flat run of operands and operators oxc-css-parser reads for `n`, a `/` unary's operand opening its own. */
function flatValues(n: number, ctx: SCtx): number[] {
  const k = kind(n, ctx);
  if (k !== "binary_expression" && !slashUnary(n, ctx)) return [n];
  return children(n, ctx.tree)
    .filter((c) => !isComment(c, ctx))
    .flatMap((c) => flatValues(c, ctx));
}

/**
 * The comma group of values `node` sits in, flattened as oxc-css-parser reads it, when a `/` unary makes it hold a
 * `/` after a `/` or opening it (`a // c`, `// c d`); else undefined, the group laid out as prettier does. `calc`: in
 * a math function, whose `//` oxc-css-parser fails on and prints as written.
 */
function slashRun(node: number, ctx: SCtx): { flat: number[]; calc: boolean } | undefined {
  const t = ctx.tree;
  let top = node;
  while (parentIs(t, top, "binary_expression") || parentIs(t, top, "unary_expression")) top = t.parent(top);
  const container = t.parent(top);
  if (container === NO_NODE) return undefined;
  let group: number[] = [];
  let found: number[] | undefined;
  for (const c of children(container, t)) {
    if (isComment(c, ctx)) continue;
    if (!t.named(c) || kind(c, ctx) === "property_name" || kind(c, ctx) === "important") {
      if (found) break;
      group = [];
      continue;
    }
    group.push(c);
    if (c === top) found = group;
  }
  const hasSlashUnary = (n: number): boolean =>
    slashUnary(n, ctx) || (kind(n, ctx) === "binary_expression" && children(n, t).some(hasSlashUnary));
  if (found === undefined || !found.some(hasSlashUnary)) return undefined;
  const calc = ancestorWhere(t, node, ["call_expression"], ["declaration", "block"], (a) =>
    mathFunctions.has(t.text(t.child(a, 0)).toLowerCase()),
  );
  return { flat: found.flatMap((c) => flatValues(c, ctx)), calc };
}

/**
 * Whether oxc keeps `flat[i - 1]` and `flat[i]` joined where either is a `/` (`base_separator`'s solidus rules), in
 * a run `slashRun` found. A run holding a `+`, `-` or `*` is no typed value, so oxc lays its raw tokens out, joining
 * a `/` written without a gap unless a word or a function sits beside it; a typed one also joins a `/` written
 * without a gap on both sides, the value after a leading `/` or after a `/` after a `/`, unless a word or a function
 * sits beside. Undefined where neither is a `/`.
 */
function slashJoined(flat: number[], i: number, ctx: SCtx): boolean | undefined {
  const t = ctx.tree;
  const [y, prev, curr, next] = [flat[i - 2], flat[i - 1] as number, flat[i] as number, flat[i + 1]];
  const sol = (n: number | undefined) => n !== undefined && kind(n, ctx) === "/";
  if (!sol(curr) && !sol(prev)) return undefined;
  const gap = t.adjoins(prev, curr);
  if (sol(flat[0]) && gap) return true;
  const wordLike = (n: number | undefined) =>
    n !== undefined && ["plain_value", "call_expression"].includes(kind(n, ctx));
  if (flat.some((n) => ["+", "-", "*"].includes(kind(n, ctx)))) {
    const wordish = (n: number | undefined, left: boolean) =>
      wordLike(n) || (left && n !== undefined && kind(n, ctx) === "parenthesized_value");
    if (sol(curr)) return gap && !wordish(next, false) && !wordish(prev, true);
    return gap && !wordish(curr, false) && !wordish(y, true);
  }
  if (sol(curr) && gap && (next === undefined || t.adjoins(curr, next))) return true;
  if (sol(prev) && gap && y !== undefined && t.adjoins(y, prev)) return true;
  if (i === 1 && sol(prev)) return true;
  const spaceBefore = wordLike(next) || wordLike(prev);
  const spaceAfter = wordLike(curr) || wordLike(y);
  const tightRule = (sol(curr) && !spaceBefore) || (sol(prev) && !spaceAfter);
  return tightRule && (gap || (sol(prev) && (i < 2 || sol(y))));
}

/** `slashJoined` before `c`, a node of the run `slashRun` found, or undefined outside one. */
function slashJoinedBefore(c: number, ctx: SCtx): boolean | undefined {
  const run = slashRun(c, ctx);
  if (run === undefined) return undefined;
  const first = flatValues(c, ctx)[0] as number;
  const i = run.flat.indexOf(first);
  if (i < 1) return undefined;
  if (run.calc) return ctx.tree.adjoins(run.flat[i - 1] as number, first);
  return slashJoined(run.flat, i, ctx);
}

/**
 * Whether `node` sits in a `grid`/`grid-template*` declaration whose value the source breaks across lines, which
 * prettier then prints a line per source line (format.ts's `keepLines`), words within a line a space apart.
 */
function gridLines(node: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  let decl = t.parent(node);
  while (decl !== NO_NODE && kind(decl, ctx) === "binary_expression") decl = t.parent(decl);
  if (decl === NO_NODE || kind(decl, ctx) !== "declaration") return false;
  if (!firstTextIs(ctx, decl, undefined, ["grid"], ["grid-template"], true)) return false;
  const kids = children(decl, t);
  const colon = kids.findIndex((c) => kind(c, ctx) === ":");
  const first = kids[colon + 1];
  if (colon === -1 || first === undefined) return false;
  // Postorder numbers a node after its leaves, so the declaration's leaves are those before it.
  const end = t.ord(decl);
  for (let l = nextLeaf(t, firstLeaf(t, first)); l !== NO_NODE && t.ord(l) < end; l = nextLeaf(t, l))
    if (t.lf(l) > 0 && kind(l, ctx) !== ";") return true;
  return false;
}

/** A node of a declaration's comma entry that holds other items too, which the entry packs in a fill. */
function amongWords(node: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  if (!parentIs(t, node, "declaration")) return false;
  const siblings = children(t.parent(node), t);
  const i = siblings.indexOf(node);
  return [siblings[i - 1], siblings[i + 1]].some(
    (n) => n !== undefined && t.named(n) && !["property_name", "important", "ERROR"].includes(kind(n, ctx)),
  );
}

/**
 * Prettier's math in a value, which postcss-value-parser reads as a flat run of words and operators where the
 * grammar nests it leftwards: so the outermost expression lays the chain out, the inner ones adding only their
 * operands and operators. In a value, an operator follows its left operand after a space and the right operand
 * follows it after a line, all packed in one fill (printCommaSeparatedValueGroup's `indent(fill(...))`), but where
 * `joinedMath` keeps two joined; inside an unquoted `url()`, one word, as written. In a Sass directive's
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
  // A grid's lines are the enclosing entry's, already indented: no indent or fill of the chain's own.
  const grid = !directive && gridLines(node, ctx);
  // A chain among other words of a declaration's entry shares that entry's fill, each operand and operator an item
  // of it, as oxc-css-parser reads them as values of the one list.
  const own = outermost && !(!directive && !grid && amongWords(node, ctx));
  if (own) {
    open(GROUP);
    if (!grid) open(INDENT);
    if (!directive && !grid) {
      open(FILL);
      open(FILL_ITEM);
    }
  }
  let top = node;
  while (parentIs(t, top, "binary_expression")) top = t.parent(top);
  const flat = directive ? [] : chain(top, ctx);
  const font =
    !directive &&
    ancestorWhere(t, node, ["declaration"], ["block"], (a) => firstTextIs(ctx, a, undefined, ["font"], ["--"], true));
  // postcss-value-parser reads an unquoted `url()` as one word, printed as written.
  const url = ancestorWhere(t, node, ["call_expression"], ["declaration", "block"], (a) =>
    firstTextIs(ctx, a, undefined, ["url"], [], true),
  );
  const spaced = (prev: number, c: number) => {
    if (directive) return true;
    if (url) return !t.adjoins(prev, c);
    const slash = slashJoinedBefore(c, ctx);
    if (slash !== undefined) return !slash;
    const first = kind(c, ctx) === "binary_expression" ? chain(c, ctx)[0] : c;
    return !joinedMath(flat, flat.indexOf(first as number), calc, font, ctx);
  };
  // The fill may break before a `*` or `/` too.
  const breaksBefore = !directive;
  const items = new Set(ctx.items(node));
  let prev = -1;
  const separate = (c: number) => {
    if (prev !== -1 && !tight && spaced(prev, c)) {
      if (grid) {
        if (breaksBetween(t, prev, c)) sHardline();
        else sText(" ");
      } else if (
        (operators.has(kind(c, ctx)) && !(breaksBefore && ["*", "/"].includes(kind(c, ctx)))) ||
        dangling.includes(prev)
      )
        sText(" ");
      else if (directive) sLine(0);
      else {
        close();
        sLine(0);
        open(FILL_ITEM);
      }
    }
    prev = c;
  };
  // A `/` unary in a `slashRun` joins the chain: its `/` and operand are items of the fill of their own.
  const emit = (c: number) => {
    const [op, operand] = children(c, t);
    if (directive || !slashUnary(c, ctx) || op === undefined || operand === undefined || slashRun(c, ctx) === undefined)
      return ctx.print(c);
    sToken(op, t.text(op));
    separate(operand);
    emit(operand);
  };
  // `beforeBreakingOperator`'s comments, each an item of the chain one space before what follows it.
  const dangling = ctx.danglingComments(node);
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (dangling.includes(c)) {
      separate(c);
      ctx.comment(c);
      continue;
    }
    if (named && !items.has(c)) continue;
    separate(c);
    if (named) emit(c);
    else sToken(c, t.text(c));
  }
  if (own) {
    if (!directive && !grid) {
      close();
      close();
    }
    if (!grid) close();
    close();
  }
}

/**
 * An operator before a value (`-(-1)`, `hue(* 20)`), which postcss-value-parser reads as a word or a math operator of
 * its own: a `*` then a space; a `+` or `-` after the gap the source has (`alpha(- .75)`); a `/` joined.
 */
export function unaryExpression(node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const [op, operand] = children(node, t);
  if (op === undefined || operand === undefined) return;
  sToken(op, t.text(op));
  const o = kind(op, ctx);
  const slash = o === "/" ? slashJoinedBefore(operand, ctx) : undefined;
  if (slash !== undefined) {
    if (!slash) sText(" ");
    return ctx.print(operand);
  }
  // The gap after a `+` or `-` stays everywhere (`func(+ 20px)`).
  if (o === "*" || ((o === "+" || o === "-") && !t.adjoins(op, operand))) sText(" ");
  ctx.print(operand);
}

/**
 * Two items of a Sass value written without a gap, which prettier keeps joined, but not after a paren group:
 * postcss-value-parser reads `($i)>(0)` as the group `($i)` and the function `>(0)`, two words.
 */
const adjoinsWord = (ctx: SCtx, prev: number, c: number) =>
  ctx.tree.adjoins(prev, c) && kind(prev, ctx) !== "parenthesized_value";

/** A comma-split entry's items as words: packed in a fill of their own, items written without a gap joined. */
function words(items: number[], ctx: SCtx, joined: (prev: number, c: number) => boolean): void {
  const t = ctx.tree;
  const item = (c: number) => (t.named(c) ? ctx.print(c) : sToken(c, t.text(c)));
  if (items.every((c, i) => i === 0 || joined(items[i - 1] as number, c))) return items.forEach(item);
  open(GROUP);
  open(INDENT);
  open(FILL);
  open(FILL_ITEM);
  items.forEach((c, i) => {
    if (i > 0 && !joined(items[i - 1] as number, c)) {
      close();
      sLine(0);
      open(FILL_ITEM);
    }
    item(c);
  });
  for (let k = 0; k < 4; k++) close();
}

/**
 * A Sass directive's prelude (`@mixin`, `@include`, `@each`, ...), which prettier parses as a value: its comma list
 * packed and indented once it breaks, each entry's words filled. Before parsing, prettier joins the first word to
 * a `(` after it (`@mixin name (...)`), but after `@else`'s `if`.
 */
export function sassDirective(node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const run = splitRun(ctx, node, ",", ["at_keyword", ";"], ["block"]);
  ctx.print(t.child(node, 0));
  sText(" ");
  const first = run.entries[0]?.items[0];
  const joined = (prev: number, c: number) =>
    adjoinsWord(ctx, prev, c) ||
    (prev === first &&
      kind(prev, ctx) === "plain_value" &&
      kind(c, ctx) === "parenthesized_value" &&
      !t.text(prev).startsWith("if"));
  const entries = run.entries;
  if (entries.length === 1) words((entries[0] as SplitEntry).items, ctx, joined);
  else if (entries.length > 1) {
    open(GROUP);
    open(INDENT);
    open(FILL);
    entries.forEach((e, i) => {
      if (i > 0) sLine(0);
      open(FILL_ITEM);
      words(e.items, ctx, joined);
      if (e.sep !== -1) sToken(e.sep, t.text(e.sep));
      close();
    });
    close();
    close();
    close();
  }
  if (entries.length === 1 && (entries[0] as SplitEntry).sep !== -1) {
    const sep = (entries[0] as SplitEntry).sep;
    sToken(sep, t.text(sep));
  }
  for (const c of run.trail) {
    sText(" ");
    ctx.print(c);
  }
  if (run.trail.length > 0) return;
  const semi = children(node, t).find((c) => kind(c, ctx) === ";" && t.text(c) !== "");
  if (semi === undefined) sToken(node, ";", true);
  else sToken(semi, t.text(semi));
}

/**
 * A Sass argument list, list or map in a directive's prelude: prettier's paren group, its entries one per line once
 * it breaks. After an entry of several words (a `name: value` pair among them), a blank line the source has stays and
 * breaks the group (printCommaSeparatedValueGroup's SCSS map rule).
 */
export function sassList(node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const token = (text: string) => children(node, t).find((c) => !t.named(c) && t.text(c) === text);
  const bracket = (text: string) => {
    const c = token(text);
    if (c === undefined) sToken(node, text, true);
    else sToken(c, t.text(c));
  };
  const run = splitRun(ctx, node, ",", ["(", ")"], []);
  open(GROUP);
  bracket("(");
  if (run.entries.length > 0) {
    open(INDENT);
    sLine(SOFT);
    run.entries.forEach((e, i) => {
      if (i > 0) sLine(0);
      words(e.items, ctx, (prev, c) => adjoinsWord(ctx, prev, c));
      if (e.sep !== -1) sToken(e.sep, t.text(e.sep));
      const last = e.items[e.items.length - 1];
      const group = e.items.length > 1 || (last !== undefined && kind(last, ctx) === "keyword_argument");
      if (i < run.entries.length - 1 && group && last !== undefined && nextLineEmpty(t, last)) sHardline();
    });
    close();
  }
  sLine(SOFT);
  bracket(")");
  close();
}

const isDirective = (n: number, ctx: SCtx) => firstTextIs(ctx, n, undefined, directives, [], false);
const inDirective = (n: number, ctx: SCtx) =>
  ancestorWhere(ctx.tree, n, ["at_rule", "postcss_statement"], ["block"], (a) => isDirective(a, ctx));
/** Inside a Sass variable's value (`$map: (...)`), which prettier lays out as a directive's (its SCSS map). */
const inVariable = (n: number, ctx: SCtx) =>
  ancestorWhere(ctx.tree, n, ["declaration"], ["block"], (a) => firstTextIs(ctx, a, undefined, [], ["$"], false));

/**
 * Prettier's raw at-rule params: the children as written, one space wherever the source has a gap and wherever
 * `spaced` says, none before the `;`; a child `own` names prints by its own rule. With `comments`, the node's
 * comments (dangling on it, `handleComment`) print in place among them.
 */
function raw(
  node: number,
  ctx: SCtx,
  own: (c: number) => boolean,
  spaced: (prev: number, c: number) => boolean,
  tight: (c: number) => boolean = () => false,
  comments = false,
) {
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (comments && isComment(c, ctx)) {
      if (prev !== -1 && !t.adjoins(prev, c)) sText(" ");
      prev = c;
      ctx.comment(c);
      continue;
    }
    if (named && !items.has(c)) continue;
    if (prev !== -1 && kind(c, ctx) !== ";" && !tight(c) && (spaced(prev, c) || !t.adjoins(prev, c))) sText(" ");
    prev = c;
    if (named && own(c)) ctx.print(c);
    else if (named) {
      const comments = !ctx.ownsComments(c);
      if (comments) printLeadingComments(ctx, c);
      sToken(c, t.text(c));
      if (comments) printTrailingComments(ctx, c);
    } else sToken(c, t.text(c));
  }
}

/** A Sass directive, else as written; `@page:first` stays joined, as postcss reads a name up to the first gap. */
export function atRule(node: number, ctx: SCtx): void {
  if (isDirective(node, ctx)) return sassDirective(node, ctx);
  const own = (c: number) => kind(c, ctx) === "at_keyword" || kind(c, ctx) === "block";
  const block = (c: number) => kind(c, ctx) === "block";
  const comma = (c: number) => kind(c, ctx) === ",";
  // oxfmt prints a `@layer` list one space after each comma and none before one, unless a comment is among it:
  // then the list as written, each gap one space, its comments in place.
  if (layerList(node, ctx.tree)) {
    if (children(node, ctx.tree).some((c) => isComment(c, ctx))) return raw(node, ctx, own, (_, c) => block(c), undefined, true);
    return raw(node, ctx, own, (prev, c) => block(c) || comma(prev), comma);
  }
  raw(node, ctx, own, (_, c) => block(c));
}

const layerList = (node: number, t: FormatTree) =>
  t.kindName(node) === "at_rule" && /^@layer$/i.test(t.text(t.child(node, 0)));

/** A Sass directive or postcss-mixins' `@define-mixin`, else as written. */
export function postcssStatement(node: number, ctx: SCtx): void {
  if (isDirective(node, ctx)) return sassDirective(node, ctx);
  raw(node, ctx, () => false, (prev) => kind(prev, ctx) === "at_keyword");
}

/**
 * Sass's `name: value`: the value after a space, hanging under the name once past the width, but a map hugging the
 * name (`$key: (`).
 */
export function keywordArgument(node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  const hug = children(node, t).some((c) => kind(c, ctx) === "parenthesized_value");
  let prev = -1;
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    const hang = prev !== -1 && !hug && kind(prev, ctx) === ":";
    if (hang) {
      open(GROUP);
      open(INDENT);
      sLine(0);
    } else if (prev !== -1 && kind(c, ctx) !== ":") sText(" ");
    prev = c;
    if (named) ctx.print(c);
    else sToken(c, t.text(c));
    if (hang) {
      close();
      close();
    }
  }
}

/**
 * A Sass list or map (in a directive, or a `$variable`'s value) by `sassList`, else on one line: a space after each
 * comma, none before it, and one between two words wherever the source has a gap (`foo( (1 ,2) )` prints
 * `foo((1, 2))`, `(1 +2)` stays).
 */
export function parenthesizedValue(node: number, ctx: SCtx): void {
  if (inDirective(node, ctx) || inVariable(node, ctx)) return sassList(node, ctx);
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    const text = named ? "" : t.text(c);
    if (prev !== -1 && text !== "," && text !== ")" && kind(prev, ctx) !== "(" && (kind(prev, ctx) === "," || !t.adjoins(prev, c)))
      sText(" ");
    if (named) ctx.print(c);
    else sToken(c, text);
    prev = c;
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

/**
 * Prettier's css-root: the front matter, then a blank line before the stylesheet unless it is empty; before both, a
 * byte order mark the source opens with, which prettier keeps.
 */
export function frontMatterFirst(
  node: number,
  ctx: SCtx,
  print: () => void,
): void {
  const root = node === ctx.tree.root;
  if (root && ctx.tree.bom) sText("﻿");
  const fm = root ? parseFrontMatter(ctx.tree.frontMatter) : undefined;
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

/** `!important` in any case and with any gap after the `!`, which prettier prints as `!important`. */
export function important(node: number): void {
  sToken(node, "!important");
}

/**
 * Postcss's `between` of a declaration: the comments after its name and before its value, around the `:`. They
 * attach to the declaration (`handleComment`) for `declarationColon` to print. So do the block comments of the
 * value, which postcss-value-parser reads as words of their own (the declaration's `splitOn` prints them as its
 * items), and those after `!important`, postcss's `raws.important` (`declarationEnd`). Among statements, postcss's
 * comment is a statement of its own: one that starts the line the statement before it ends trails that statement.
 */
const handleComment: CommentHandler<CssOptions> = ({ tree, comment, enclosing, preceding, following, placement, text }) => {
  const ownComments = tree.kindName(enclosing) === "import_statement" || valueArguments(tree, enclosing);
  if ((ownComments && text.startsWith("/*")) || layerList(enclosing, tree))
    return { node: enclosing, as: "dangling" };
  const operand = mathOperand(tree, enclosing);
  if (operand !== undefined && text.startsWith("/*")) return { node: operand, as: "trailing" };
  if (beforeBreakingOperator(tree, comment, enclosing) && text.startsWith("/*")) return { node: enclosing, as: "dangling" };
  if (tree.kindName(enclosing) === "rule_set" && following !== undefined && tree.kindName(following) === "block")
    return { node: enclosing, as: "dangling" };
  if (preceding === undefined) return undefined;
  if (statementSequences.has(tree.kindName(enclosing)) && placement !== "ownLine")
    return { node: preceding, as: "trailing" };
  const declaration = ["declaration", "custom_property_set"].includes(tree.kindName(enclosing));
  if (!declaration || /:\s*progid:/i.test(tree.text(enclosing))) return undefined;
  return tree.kindName(preceding) === "property_name" || text.startsWith("/*")
    ? { node: enclosing, as: "dangling" }
    : undefined;
};

/**
 * A comment just before a value's `*` or `/` operator (`a /* q *\/ / c`), which oxc-css-parser reads as a value of
 * its own that the fill breaks before, as it may before the operator (`valueMath`).
 */
function beforeBreakingOperator(tree: FormatTree, comment: number, enclosing: number): boolean {
  if (tree.kindName(enclosing) !== "binary_expression") return false;
  let next = nextLeaf(tree, comment);
  while (next !== NO_NODE && tree.kindName(next) === "comment") next = nextLeaf(tree, next);
  return next !== NO_NODE && tree.parent(next) === enclosing && ["*", "/"].includes(tree.kindName(next));
}

/**
 * A function's arguments in a declaration's value but `url()`'s, which postcss-value-parser reads as words, a block
 * comment among them one of its own (the `arguments` rule's `splitOn` prints them as its items).
 */
function valueArguments(tree: FormatTree, node: number): boolean {
  if (tree.kindName(node) !== "arguments") return false;
  const call = tree.parent(node);
  if (tree.kindName(call) !== "call_expression" || /^url$/i.test(tree.text(tree.child(call, 0)))) return false;
  for (let up = tree.parent(call); up !== NO_NODE; up = tree.parent(up)) {
    const kind = tree.kindName(up);
    if (kind === "declaration") return !/:\s*progid:/i.test(tree.text(up));
    if (kind === "block" || kind === "at_rule" || kind === "postcss_statement") return false;
  }
  return false;
}

/**
 * The argument of a math function (`calc((1px) /* c *\/ + 2px)`) holding `node`, a calc sum or group inside it.
 * oxc's calc printer flushes no comment of its own, so a comment inside one prints after the whole argument.
 */
function mathOperand(tree: FormatTree, node: number): number | undefined {
  let operand = node;
  while (["binary_expression", "parenthesized_value"].includes(tree.kindName(operand))) {
    const up = tree.parent(operand);
    if (tree.kindName(up) === "arguments") {
      const math = mathFunctions.has(tree.text(tree.child(tree.parent(up), 0)).toLowerCase());
      return math && valueArguments(tree, up) ? operand : undefined;
    }
    operand = up;
  }
  return undefined;
}

/**
 * The source's gap between `prev` and the later `c`, rebuilt from their columns and the line breaks between: what
 * prettier prints of a raw it keeps as written (a declaration's `between` and `raws.important`).
 */
function sourceGap(t: FormatTree, prev: number, c: number): string {
  if (t.lf(c) > 0) return "\n".repeat(t.lf(c)) + " ".repeat(t.col(c));
  const text = t.text(prev);
  const lastBreak = text.lastIndexOf("\n");
  const end = lastBreak === -1 ? t.col(prev) + text.length : text.length - lastBreak - 1;
  return " ".repeat(Math.max(t.col(c) - end, 0));
}

/**
 * Postcss's `between` of `declaration`, the dangling comments before its value (`handleComment`), which starts at a
 * leading comma: oxc-css-parser reads a comment past it (`b:,/*c*\/a`) as the next entry's.
 */
function between(node: number, ctx: SCtx): number[] {
  const t = ctx.tree;
  const value = children(node, t).find(
    (c) => (t.named(c) && !isComment(c, ctx) && kind(c, ctx) !== "property_name") || t.text(c) === ",",
  );
  return ctx.danglingComments(node).filter((c) => value === undefined || t.ord(c) < t.ord(value));
}

/** The nodes whose children prettier prints as a sequence of statements (printNodeSequence). */
const statementSequences = new Set([...statementLists, "keyframe_block_list"]);

/**
 * `$x: a !default !global`: the grammar has no place for a Sass variable's flags and wraps them in an `ERROR`, which
 * formats as the value's last words rather than leaving the declaration as written.
 */
function sassFlags(error: number, t: FormatTree): boolean {
  if (t.kindName(t.parent(error)) !== "declaration" || t.count(error) === 0) return false;
  for (let i = 0; i < t.count(error); i++) if (t.kindName(t.child(error, i)) !== "important_value") return false;
  return true;
}

/** The flags `sassFlags` recovers, one space apart. */
const sassFlagList: StreamRule<CssOptions> = (error, ctx) => {
  for (let i = 0; i < ctx.tree.count(error); i++) {
    if (i > 0) sText(" ");
    const flag = ctx.tree.child(error, i);
    sToken(flag, ctx.tree.text(flag));
  }
};

/** A stylesheet that failed to parse prints as written, its own final line break included. */
export function finalLine({ tree, isBroken }: SCtx): boolean {
  return !(isBroken(tree.root) && tree.trailingLf > 0);
}

/**
 * Prettier's printNodeSequence, where a comment is a statement: a comment leading a statement ends its line, as a
 * line comment does, unless another comment follows it on that line.
 */
export function statementComment(c: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  const next = nextLeaf(t, c);
  if (next === NO_NODE || (isComment(next, ctx) && t.lf(next) === 0)) return false;
  let statement = next;
  for (let p = t.parent(statement); p !== NO_NODE && !statementSequences.has(kind(p, ctx)); p = t.parent(p))
    statement = p;
  return ctx.leadingComments(statement).includes(c);
}

/**
 * A declaration's `:` with the comments of its `between` (`handleComment`), which prettier prints as written but
 * trimmed: the first joined to the name, each later one after the gap the source has before it; those past the `:`
 * of an empty value are postcss's value, each after a space. Prettier measures
 * that raw text as one string, line breaks and all, so the value after it breaks as though the line ran on.
 */
export function declarationColon(colon: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const comments = between(node, ctx);
  if (colon === undefined) return sToken(node, ":", true);
  // Postcss's `between` starts right after the name, trimmed.
  let prev = -1;
  const put = (c: number, print: () => void) => {
    if (prev !== -1) sText(sourceGap(t, prev, c));
    print();
    prev = c;
  };
  for (const c of comments) if (t.ord(c) < t.ord(colon)) put(c, () => ctx.comment(c));
  put(colon, () => sToken(colon, ":"));
  // Past the `:`, comments with no value after them are postcss's value instead, printed as its words.
  const value = !customs.emptyValue(node, ctx);
  for (const c of comments)
    if (t.ord(c) > t.ord(colon))
      if (value) put(c, () => ctx.comment(c));
      else {
        sText(" ");
        ctx.comment(c);
      }
}

/**
 * A declaration's `;`, the source's or one of its own. After `!important`, postcss's `raws.important`: the comments
 * and gaps up to the `;` as written. After an empty value (`--empty:  ;`) prettier keeps the gap before it as written,
 * postcss's raw value: one space where the gap holds a line break; none where comments are that value
 * (`declarationColon`).
 */
export function declarationEnd(semi: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const real = semi !== undefined && t.text(semi) !== "";
  // Sass flags (`sassFlags`) end the value as `!important` does.
  const important = children(node, t).findLast((c) => kind(c, ctx) === "important" || kind(c, ctx) === "ERROR");
  if (important !== undefined) {
    // One space before each comment after `!important`, none before `;`.
    for (const c of ctx.danglingComments(node))
      if (t.ord(c) > t.ord(important)) {
        sText(" ");
        ctx.comment(c);
      }
  }
  if (!real) return sToken(node, ";", true);
  const colon = code(node, ctx).find((c) => kind(c, ctx) === ":");
  const last = colon === undefined ? undefined : between(node, ctx).filter((c) => t.ord(c) > t.ord(colon)).at(-1);
  if (colon !== undefined && last === undefined && customs.emptyValue(node, ctx) && !t.adjoins(colon, semi))
    sText(t.lf(semi) === 0 ? sourceGap(t, colon, semi) : " ");
  sToken(semi, ";");
}

/**
 * An unquoted `url()` padded with whitespace and holding an escaped paren (`url( a\(b )`), which
 * postcss-value-parser fails on: prettier then prints the whole value as written.
 */
function unparsedUrl(n: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  if (kind(n, ctx) === "call_expression" && t.count(n) === 2) {
    const [name, args] = [t.child(n, 0), t.child(n, 1)];
    const text = t.text(args);
    if (t.text(name).toLowerCase() === "url" && /\\[()]/.test(text) && /^\(\s|\s\)$/.test(text)) return true;
  }
  return children(n, t).some((c) => unparsedUrl(c, ctx));
}

/** The functions oxc-css-parser reads with the calc grammar, the one place its CSS grammar takes a `( … )` group. */
const mathFunctions = new Set(
  "calc -webkit-calc -moz-calc min max clamp sin cos tan asin acos atan sqrt exp abs sign hypot round mod rem atan2 pow log".split(
    " ",
  ),
);

/**
 * A word CSS Syntax lexes with a delim token its typed grammar has no place for (`a*c`, `a%c`, `a.c`, `a@c`), where
 * a `/` is a division, a `#name` a hash and a `$name` a Sass variable.
 */
const delimWord = (text: string) =>
  !/^u\+[\da-f?]/i.test(text) &&
  [...text.matchAll(rawTokenPattern)].some(
    (m) => m.groups?.char !== undefined && m[0] !== "/" && !(m[0] === "$" && new RegExp(`^${nameStart}`).test(text.slice((m.index ?? 0) + 1))),
  );

/**
 * A declaration's value oxc-css-parser's typed grammar cannot read to its end, so it falls back to raw tokens. That
 * grammar takes a `( … )` group only as a calc operand (`calc((1px + 2px) * 2)`) holding one calc sum (`(1px +2px)`
 * is two values), so any other group (`$map: (a: 1)`, `fn( (1) )`) makes the value raw; so does a `{ … }` outside
 * any function (`[1, {"a":1}]`, `function(x) { … }`), and so does a `:` past the property's (`a:b`).
 */
function oxcRaw(decl: number, t: FormatTree): boolean {
  if (children(decl, t).filter((c) => t.kindName(c) === ":").length > 1) return true;
  const calcSum = (paren: number) =>
    children(paren, t).filter((c) => t.named(c) && t.kindName(c) !== "comment").length === 1;
  // `a/f(c)`, which tree-sitter-css reads as the word `a/f` then a group, is `a`, `/` and the function `f(c)`.
  // `a/f(c)/g` reads as `a/f` then the math `(c)/g`, the group its first operand.
  const callParens = (paren: number) => {
    let first = paren;
    for (let up = t.parent(first); t.kindName(up) === "binary_expression" && t.child(up, 0) === first; up = t.parent(up)) {
      if (t.kindName(t.child(up, 1)) !== "/") return false;
      first = up;
    }
    const siblings = children(t.parent(first), t);
    paren = first;
    const prev = siblings[siblings.indexOf(paren) - 1];
    return prev !== undefined && t.kindName(prev) === "plain_value" && t.adjoins(prev, paren) && /\/[a-zA-Z_-][\w-]*$/.test(t.text(prev));
  };
  const raw = (n: number, inCall: boolean, inMath: boolean): boolean =>
    children(n, t).some((c) => {
      const k = t.kindName(c);
      if (k === "parenthesized_value" && !(inMath && calcSum(c)) && !callParens(c)) return true;
      if (k === "brace_value" && !inCall) return true;
      if (k === "plain_value" && !inCall && delimWord(t.text(c))) return true;
      const math =
        k === "call_expression"
          ? mathFunctions.has(t.text(t.child(c, 0)).toLowerCase())
          : inMath && (k === "arguments" || k === "binary_expression" || k === "parenthesized_value");
      return raw(c, inCall || k === "call_expression", math);
    });
  return raw(decl, false, false);
}

/** A Sass variable or custom property, whose raw value (`oxcRaw`) oxfmt prints verbatim. */
const customName = (decl: number, t: FormatTree) => /^(\$|--)/.test(t.text(t.child(decl, 0)));

const rawValue = (decl: number, ctx: SCtx): boolean => customName(decl, ctx.tree) && oxcRaw(decl, ctx.tree);

/** The source between `prev` and `c`, less any whitespace ending a line. */
function gapBefore(prev: number, c: number, t: FormatTree): string {
  if (t.lf(c) > 0) return "\n".repeat(t.lf(c)) + " ".repeat(t.col(c));
  if (t.adjoins(prev, c)) return "";
  const text = t.text(prev);
  const end = text.includes("\n") ? text.length - text.lastIndexOf("\n") - 1 : t.col(prev) + text.length;
  return " ".repeat(t.col(c) - end);
}

/** The `:` of a declaration whose value prettier keeps as written (`unparsedValue`), one space, then the value. */
export function colonThenSource(colon: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const parts = children(node, t);
  declarationColon(colon, node, ctx);
  const from = colon === undefined ? 1 : parts.indexOf(colon) + 1;
  // `!important` and Sass flags (`sassFlags`) one space after the value.
  const flag = (c: number) => kind(c, ctx) === "important" || kind(c, ctx) === "ERROR";
  const value = parts.slice(from).filter((c) => kind(c, ctx) !== ";" && !flag(c));
  // The comments before the value are postcss's `between`, which `declarationColon` printed; the value's own print
  // as written among its words.
  while (value.length > 0 && isComment(value[0] as number, ctx)) value.shift();
  let prev = -1;
  for (const c of value) {
    const gap = prev === -1 ? " " : gapBefore(prev, c, t);
    if (isComment(c, ctx)) {
      sText(gap);
      ctx.comment(c);
    } else sLiteral(c, gap + t.text(c));
    prev = c;
  }
  for (const c of parts.filter(flag)) {
    sText(" ");
    ctx.print(c);
  }
}

/**
 * One token of the raw run oxc-css-parser falls back to for a normal property's value (`rawTokens`): its CSS token
 * kind (`ident`, `number`, `dimension`, `percentage`, `hash`, `string`, `url`, or the punctuation itself), its
 * text, whether it adjoins the token before, whether a line break precedes it, and the comments before it.
 */
interface RawToken {
  readonly kind: string;
  readonly text: string;
  readonly node: number;
  readonly glued: boolean;
  readonly lf: boolean;
  readonly comments: number[];
}

type RawSeparator = "tight" | "space" | "line" | "hard";

const nameChar = String.raw`(?:[\w\u0080-￿-]|\\.)`;
const nameStart = String.raw`(?:[a-zA-Z_\u0080-￿]|\\.)`;
/** CSS Syntax's tokens as a leaf's text holds them: a number and its unit, an ident, a hash, else one character. */
const rawTokenPattern = new RegExp(
  String.raw`(?<number>[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(?:(?<percentage>%)|(?<unit>-?(?:-|${nameStart})${nameChar}*))?` +
    String.raw`|(?<ident>-?(?:-|${nameStart})${nameChar}*)|(?<hash>#${nameChar}+)|(?<space>\s+)|(?<char>[^])`,
  "gy",
);

/** The raw tokens of a normal property's value nodes, and the comments after the last. */
function rawTokens(nodes: number[], ctx: SCtx): { tokens: RawToken[]; tail: number[] } {
  const t = ctx.tree;
  const tokens: RawToken[] = [];
  let comments: number[] = [];
  let prev = -1;
  let lf = false;
  const push = (kind: string, text: string, node: number, glued: boolean) => {
    tokens.push({ kind, text, node, glued, lf, comments });
    comments = [];
    lf = false;
  };
  const visit = (n: number): void => {
    const k = kind(n, ctx);
    const glued = prev !== -1 && !isComment(prev, ctx) && t.adjoins(prev, n);
    if (t.lf(n) > 0) lf = true;
    if (isComment(n, ctx)) comments.push(n);
    else if (k === "call_expression" && /^url$/i.test(t.text(t.child(n, 0)))) push("url", "", n, glued);
    else if (k === "string_value") push("string", t.text(n), n, glued);
    // `http://a` and `progid:A` stay one word, as oxc-css-parser reads them.
    else if (k === "plain_value" && t.text(n).includes(":")) push("ident", t.text(n), n, glued);
    else if (t.count(n) > 0 && !["integer_value", "float_value", "color_value", "plain_value"].includes(k))
      return children(n, t).forEach(visit);
    else {
      let joined = glued;
      for (const m of t.text(n).matchAll(rawTokenPattern)) {
        const g = m.groups as Record<string, string | undefined>;
        if (g.space !== undefined) {
          joined = false;
          continue;
        }
        const kind =
          g.number !== undefined
            ? g.percentage !== undefined
              ? "percentage"
              : g.unit !== undefined
                ? "dimension"
                : "number"
            : g.ident !== undefined
              ? "ident"
              : g.hash !== undefined
                ? "hash"
                : m[0];
        push(kind, m[0], n, joined);
        joined = true;
      }
    }
    prev = n;
  };
  nodes.forEach(visit);
  return { tokens, tail: comments };
}

/** Oxc's `base_separator` between raw tokens `g[i - 1]` and `g[i]` of a comma group `g`, and its grid override. */
function rawSeparator(g: RawToken[], i: number, font: boolean, grid: boolean): RawSeparator {
  const sep = baseRawSeparator(g, i, font);
  if (grid && (sep === "line" || sep === "space")) return (g[i] as RawToken).lf ? "hard" : "space";
  return sep;
}

function baseRawSeparator(g: RawToken[], i: number, font: boolean): RawSeparator {
  const prev = g[i - 1] as RawToken;
  const curr = g[i] as RawToken;
  const is = (x: RawToken | undefined, kinds: string[]) => x !== undefined && kinds.includes(x.kind);
  // A glued `::` is one token to oxc, lexed left to right, which neither `:` rule touches (`a::b`, `a::: b`).
  const second = (j: number): boolean => g[j]?.kind === ":" && g[j - 1]?.kind === ":" && g[j]?.glued === true && !second(j - 1);
  const pair = (j: number) => second(j) || (g[j + 1]?.kind === ":" && second(j + 1));
  if (curr.kind === ":" && pair(i)) return curr.glued ? "tight" : "line";
  if (is(curr, [":", "}", ",", ")", "]", ";"]) || is(prev, ["{", "(", "["])) return "tight";
  if (is(prev, [",", ...(pair(i - 1) ? [] : [":"])])) return "space";
  if (curr.kind === "*" || prev.kind === "*") return "line";
  if ((g[0] as RawToken).kind === "/" && curr.glued) return "tight";
  if (font) {
    const fontSize = (x: RawToken | undefined) => is(x, ["number", "dimension", "percentage", ")"]);
    if (curr.kind === "/" && curr.glued && fontSize(prev)) return "tight";
    if (prev.kind === "/" && prev.glued && fontSize(g[i - 2])) return "tight";
  }
  const wordish = (x: RawToken | undefined) => is(x, ["ident", ")"]);
  if (curr.kind === "/") return curr.glued && !wordish(g[i + 1]) && !wordish(prev) ? "tight" : "line";
  if (prev.kind === "/") return curr.glued && !wordish(curr) && !wordish(g[i - 2]) ? "tight" : "line";
  if (curr.glued) return "tight";
  return is(curr, ["+", "-", "*", "%", "/"]) ? "space" : "line";
}

function printRawToken(token: RawToken, ctx: SCtx): void {
  for (const c of token.comments) {
    ctx.comment(c);
    sText(" ");
  }
  if (token.kind === "url") ctx.print(token.node);
  else sToken(token.node, token.text);
}

/**
 * Oxc's `write_comma_group` over raw tokens: runs of tokens no line may split, packed in a fill, a comment between
 * two runs an entry of its own, and the comments after the value (`tail`) last.
 */
function rawGroup(g: RawToken[], tail: number[], font: boolean, grid: boolean, ctx: SCtx): void {
  const first = g[0];
  if (first === undefined) return tail.forEach((c) => ctx.comment(c));
  if (g.length === 1 && tail.length === 0) return printRawToken(first, ctx);
  for (const c of first.comments) {
    ctx.comment(c);
    sText(" ");
  }
  const seps = g.map((_, i) => (i === 0 ? "line" : rawSeparator(g, i, font, grid)));
  let entries = 0;
  const entry = (sep: RawSeparator, print: () => void) => {
    if (entries++ > 0) {
      if (sep === "hard") sHardline();
      else sLine(0);
    }
    open(FILL_ITEM);
    print();
    close();
  };
  open(GROUP);
  open(INDENT);
  if (seps.some((s, i) => s === "hard" && (g[i] as RawToken).comments.length === 0)) sHardline();
  open(FILL);
  for (let i = 0; i < g.length; ) {
    let end = i + 1;
    while (end < g.length && (seps[end] === "tight" || seps[end] === "space")) end++;
    const start = i;
    const head = g[start] as RawToken;
    if (start > 0) for (const c of head.comments) entry("line", () => ctx.comment(c));
    entry(seps[start] as RawSeparator, () => {
      for (let j = start; j < end; j++) {
        if (j > start && seps[j] === "space") sText(" ");
        const token = g[j] as RawToken;
        if (j === start) printRawToken({ ...token, comments: [] }, ctx);
        else printRawToken(token, ctx);
      }
    });
    i = end;
  }
  for (const c of tail) entry("line", () => ctx.comment(c));
  close();
  close();
  close();
}

/**
 * The `:` of a normal property's value oxc-css-parser reads as raw tokens (`rawTokens`), then that value as oxc's
 * `write_declaration_value` lays it out: its top-level comma groups, each a fill of its tokens, one per line under
 * the name when there are several.
 */
export function colonThenRawTokens(colon: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  declarationColon(colon, node, ctx);
  const parts = children(node, t);
  const end = (c: number) => [";", "important", "ERROR"].includes(kind(c, ctx));
  const from = colon === undefined ? 1 : parts.indexOf(colon) + 1;
  const value = parts.slice(from, parts.findIndex((c, i) => i >= from && end(c)) >>> 0);
  // The comments before the value are postcss's `between`, which `declarationColon` printed.
  while (value.length > 0 && isComment(value[0] as number, ctx)) value.shift();
  const { tokens, tail } = rawTokens(value, ctx);
  const groups: { tokens: RawToken[]; comma?: RawToken }[] = [{ tokens: [] }];
  let depth = 0;
  for (const token of tokens) {
    const group = groups.at(-1) as { tokens: RawToken[]; comma?: RawToken };
    if (depth === 0 && token.kind === ",") {
      group.comma = token;
      groups.push({ tokens: [] });
      continue;
    }
    if ("([{".includes(token.kind)) depth++;
    else if (")]}".includes(token.kind)) depth--;
    group.tokens.push(token);
  }
  if (groups.length > 1 && (groups.at(-1) as { tokens: RawToken[] }).tokens.length === 0) groups.pop();
  const prop = t.text(parts[0] as number).toLowerCase();
  const font = prop === "font";
  const grid = prop === "grid" || prop.startsWith("grid-template");
  if (groups.length === 1) {
    sText(" ");
    rawGroup((groups[0] as { tokens: RawToken[] }).tokens, tail, font, grid, ctx);
  } else rawGroups(groups, tail, font, grid, ctx);
  // `!important` and Sass flags (`sassFlags`) one space after the value.
  for (const c of parts.slice(from).filter((c) => kind(c, ctx) === "important" || kind(c, ctx) === "ERROR")) {
    sText(" ");
    ctx.print(c);
  }
}

function rawGroups(
  groups: { tokens: RawToken[]; comma?: RawToken }[],
  tail: number[],
  font: boolean,
  grid: boolean,
  ctx: SCtx,
): void {
  open(INDENT);
  groups.forEach((g, i) => {
    sHardline();
    const last = i === groups.length - 1;
    rawGroup(g.tokens, last ? tail : [], font, grid, ctx);
    if (!last && g.comma !== undefined) {
      for (const c of g.comma.comments) {
        sText(" ");
        ctx.comment(c);
      }
      sToken(g.comma.node, ",");
    }
  });
  close();
}

/** A query's words where prettier reads it as a value (`@import`'s media, `@supports`), `and`/`not` chains flattened. */
const queryWords = (n: number, ctx: SCtx): number[] =>
  kind(n, ctx) === "binary_query" || kind(n, ctx) === "unary_query"
    ? children(n, ctx.tree).flatMap((c) => queryWords(c, ctx))
    : [n];

const isParenQuery = (c: number, ctx: SCtx) =>
  kind(c, ctx) === "feature_query" || kind(c, ctx) === "parenthesized_query";

/**
 * `@supports`'s words as prettier's value words: `not`, `and` or `or` written against the paren group after it, or
 * the prelude's first word before one (prettier's parser drops that gap), is a function, the two one word apart by
 * a space that never breaks.
 */
function supportsItems(words: number[], ctx: SCtx, top: boolean): number[][] {
  const t = ctx.tree;
  const items: number[][] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as number;
    const next = words[i + 1];
    const keyword = !t.named(w) && ["not", "and", "or"].includes(t.text(w).toLowerCase());
    if (keyword && next !== undefined && isParenQuery(next, ctx) && ((top && i === 0) || t.adjoins(w, next))) {
      items.push([w, next]);
      i++;
    } else items.push([w]);
  }
  return items;
}

/** A value word of `supportsItems`, a function's name and paren group a space apart. */
function supportsItem(item: number[], ctx: SCtx): void {
  item.forEach((c, i) => {
    if (i > 0) sText(" ");
    queryWord(c, ctx, true);
  });
}

/**
 * A word of a query read as a value: a paren group as prettier's value-paren_group, its words a fill indented
 * inside it, a `:` joined to the word before it; in `@supports`, its words as `supportsItems`.
 */
function queryWord(c: number, ctx: SCtx, supports = false): void {
  const t = ctx.tree;
  if (ctx.isComment(c)) return ctx.comment(c);
  if (!t.named(c)) return sToken(c, t.text(c));
  if (!isParenQuery(c, ctx)) return ctx.printNode(c);
  const kids = children(c, t);
  const inner = kids.slice(1, -1).flatMap((k) => queryWords(k, ctx));
  const items = supports ? supportsItems(inner, ctx, false) : inner.map((k) => [k]);
  open(GROUP);
  queryWord(kids[0] as number, ctx);
  open(INDENT);
  sLine(SOFT);
  open(GROUP);
  open(INDENT);
  open(FILL);
  open(FILL_ITEM);
  items.forEach((item, i) => {
    if (i > 0 && kind(item[0] as number, ctx) !== ":") {
      close();
      sLine(0);
      open(FILL_ITEM);
    }
    if (supports) supportsItem(item, ctx);
    else queryWord(item[0] as number, ctx);
  });
  for (let k = 0; k < 5; k++) close();
  sLine(SOFT);
  queryWord(kids[kids.length - 1] as number, ctx);
  close();
}

/**
 * `@supports`'s prelude, which prettier parses as a value: its words a fill, indented, each paren group breaking
 * inside once past the width; one word alone, unindented.
 */
export function supportsValue(at: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  if (at !== undefined) sToken(at, atName(t.text(at)));
  sText(" ");
  const kids = children(node, t);
  const words = kids.filter((c) => c !== at && kind(c, ctx) !== "block").flatMap((c) => queryWords(c, ctx));
  const items = supportsItems(words, ctx, true);
  if (items.length === 1) supportsItem(items[0] as number[], ctx);
  else {
    open(GROUP);
    open(INDENT);
    open(FILL);
    items.forEach((item, i) => {
      if (i > 0) sLine(0);
      open(FILL_ITEM);
      supportsItem(item, ctx);
      close();
    });
    for (let k = 0; k < 3; k++) close();
  }
  const block = kids.find((c) => kind(c, ctx) === "block");
  if (block !== undefined) {
    sText(" ");
    ctx.printNode(block);
  }
}

/**
 * `@import`'s prelude, which prettier parses as a value: its comma list one entry per line once past the width, each
 * entry's words packed after a line of their own, all at one indent (`url(...)` then `  projection tv`).
 */
export function importStatement(node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const parts = children(node, t);
  const at = parts.find((c) => kind(c, ctx) === "@import");
  if (at !== undefined) sToken(at, atName(t.text(at)));
  sText(" ");
  const item = (c: number) =>
    !t.named(c) ? sToken(c, t.text(c)) : ctx.isComment(c) ? ctx.comment(c) : ctx.printNode(c);
  // The prelude's comments are its words too, as `splitOn`'s `comments: "all"`, and so are a media query's.
  const run = splitRun(ctx, node, ",", ["@import", ";"], ["block"], "all");
  // Several entries are prettier's paren group, indented, each entry a comma group indented once more but
  // `url(...)` and one word (insideURLFunctionInImportAtRuleNode), which prettier leaves unindented even alone.
  const nested = run.entries.length > 1;
  const isUrl = (c: number) =>
    kind(c, ctx) === "call_expression" && t.text(t.child(c, 0)) === "url";
  open(GROUP);
  if (nested) open(INDENT);
  run.entries.forEach((e, i) => {
    if (i > 0) sLine(0);
    const words = e.items.flatMap((c) => queryWords(c, ctx));
    const indent = !(words.length === 2 && isUrl(words[0] as number));
    if (indent) open(INDENT);
    open(FILL);
    words.forEach((c, j) => {
      if (j > 0) sLine(0);
      open(FILL_ITEM);
      if (isParenQuery(c, ctx)) queryWord(c, ctx);
      else item(c);
      close();
    });
    close();
    if (indent) close();
    if (e.sep !== -1) sToken(e.sep, t.text(e.sep));
  });
  if (nested) close();
  close();
  for (const c of run.trail) {
    sText(" ");
    ctx.print(c);
  }
  if (run.trail.length > 0) return;
  const semi = parts.find((c) => kind(c, ctx) === ";");
  if (semi !== undefined && t.text(semi) !== "") sToken(semi, ";");
  else sToken(node, ";", true);
}

/** A media prelude's leaves in source order, comments among them, a query's parts and parens split apart. */
function mediaAtoms(node: number, ctx: SCtx): number[] {
  const t = ctx.tree;
  const atoms = (n: number): number[] =>
    kind(n, ctx).endsWith("_query") && t.count(n) > 0 ? children(n, t).flatMap(atoms) : [n];
  return children(node, t)
    .filter((c) => kind(c, ctx) !== "@media" && kind(c, ctx) !== "block")
    .flatMap(atoms);
}

/**
 * `@media`'s prelude holding a comment, as postcss-media-query-parser reads the source: queries split at the commas
 * outside parens, each query's elements at its whitespace outside parens, one ending at a `)` that closes its
 * parens. Prettier joins the elements a space apart and prints each as written, but for an element opening with
 * `(`, a feature expression: its feature trimmed and its spaces collapsed, a space after its `:`, its value trimmed.
 */
export function mediaQueries(at: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  if (at !== undefined) sToken(at, atName(t.text(at)));
  sText(" ");
  const atoms = mediaAtoms(node, ctx);
  const is = (c: number, text: string) => !t.named(c) && t.text(c) === text;
  let level = 0;
  // Whether the parens open a feature expression, and its `:`.
  let expression = false;
  let colon = -1;
  let prev = -1;
  open(GROUP);
  open(INDENT);
  for (const c of atoms) {
    if (prev !== -1) {
      if (level === 0) {
        if (is(prev, ",")) sLine(0);
        else if (!is(c, ",") && (!t.adjoins(prev, c) || is(prev, ")"))) sText(" ");
      } else if (!expression) sText(sourceGap(t, prev, c));
      else if (level === 1 && (is(prev, "(") || is(c, ")"))) {
        // The feature and the value are trimmed.
      } else if (level === 1 && colon === -1 && is(c, ":")) colon = c;
      else if (prev === colon) sText(" ");
      else if (colon === -1) sText(sourceGap(t, prev, c).replace(/ +/g, " "));
      else sText(sourceGap(t, prev, c));
    }
    if (level === 0 && is(c, "(")) {
      expression = prev === -1 || !t.adjoins(prev, c) || is(prev, ")") || is(prev, ",");
      colon = -1;
    }
    if (ctx.isComment(c)) ctx.comment(c);
    else if (t.named(c)) ctx.printNode(c);
    else sToken(c, t.text(c));
    if (is(c, "(")) level++;
    else if (is(c, ")")) level = Math.max(level - 1, 0);
    prev = c;
  }
  close();
  close();
  const block = children(node, t).find((c) => kind(c, ctx) === "block");
  if (block !== undefined) {
    sText(" ");
    // The prelude's last comments attach to the block, but print above as the query's.
    ctx.printNode(block);
  }
}

/**
 * A rule's selector and block, a space between. Prettier's selector-unknown: postcss-selector-parser is not given a
 * selector holding a comment, whose source up to the rule's `{` (postcss's selector and `between`) prints as written
 * but trimmed. The comments before the block attach to the rule (`handleComment`).
 */
export function ruleSet(node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const holds = (n: number): boolean => children(n, t).some((c) => ctx.isComment(c) || holds(c));
  const kids = children(node, t);
  const asWritten = kids.some((c) => kind(c, ctx) !== "block" && (ctx.isComment(c) || holds(c)));
  let prev = -1;
  for (const c of kids) {
    if (prev !== -1) sText(asWritten && kind(c, ctx) !== "block" ? sourceGap(t, prev, c) : " ");
    if (ctx.isComment(c)) ctx.comment(c);
    else if (asWritten && kind(c, ctx) !== "block") sToken(c, t.text(c));
    else ctx.print(c);
    prev = c;
  }
}

/** The hand-written rules format.ts names. */
export const handWritten = {
  ...customs,
  important,
  declarationColon,
  declarationEnd,
  colonThenSource,
  colonThenRawTokens,
  importStatement,
  mediaQueries,
  supportsValue,
  valueMath,
  unaryExpression,
  number,
  atRule,
  postcssStatement,
  parenthesizedValue,
  keywordArgument,
  sassList,
  ruleSet,
};

const cssStream = gen.css(handWritten);

/** CSS as prettier 3.9.9's postcss printer lays it out; the layouts are format.ts, generated into fmt.gen.ts. */
export const css: Language<CssOptions> = {
  ...defineLanguage(grammar, {
    parser: language,
    // What `meaning` reads whole: a string's quotes and escapes, and a name's identifier, are separate leaves.
    atoms: ["string_value", "class_name", "plain_value", "color_value"],
    lineComments: {},
    defaults,
    settings: prettierSettings,
    normalize,
    handleComment,
    // oxc-css-parser drops a value's empty last comma group, and with it the `,` before it.
    dropped: ["trailing_comma"],
    drops: droppedComma,
    layoutBlind: true,
  }),
  stream: {
    ...cssStream,
    rules: new Map([
      ...cssStream.rules,
      ["ERROR", sassFlagList],
      ["plain_value", (node, ctx) => plainWord(node, ctx) || cssStream.rules.get("plain_value")?.(node, ctx)],
    ]),
    wrap: frontMatterFirst,
    commentEndsLine: statementComment,
    keepsSource: prettierIgnored,
    recovered: sassFlags,
    finalLine,
  },
};
