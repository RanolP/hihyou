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
import { firstLeaf, type FormatTree, nextLeaf } from "../../fmt/tree.js";
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
  return lexemes.map((l, i) => {
    const next = lexemes[i + 1]?.text;
    const prev = lexemes[i - 1]?.text;
    if (l.text === ";" && (next === undefined || next === "}" || next === ";" || prev === "{"))
      return undefined;
    if (sign(i)) return undefined;
    if (sign(i - 1)) return meaning(tree, l.node, `${prev}${l.text}`);
    return meaning(tree, l.node, l.text);
  });
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

/** The rules `when` names in format.ts. */
export const customs = {
  /** Prettier indents a selector of more than two nodes as it breaks. */
  longSelector: (node, ctx) => parts(node, ctx) > 2,
  /** A declaration with nothing between its `:` and its `;` (`--empty:;`). */
  emptyValue: (node, ctx) => code(node, ctx).every((c) => !ctx.tree.named(c) || kind(c, ctx) === "property_name"),
  unparsedValue: (node, ctx) => unparsedUrl(node, ctx) || rawValue(node, ctx),
  /** A media query list holding a comment, which `mediaQueries` prints as postcss-media-query-parser splits it. */
  mediaComments: (node, ctx) => mediaAtoms(node, ctx).some((c) => isComment(c, ctx)),
  ownWord: (node, ctx) => ownWord(node, ctx),
} satisfies Record<string, PredicateRule<CssOptions>>;

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
  // A number, a word or a function joined to a function before it stays joined (`f(1)-2`, `f(1)f(2)`).
  if (
    kind(prev, ctx) === "call_expression" &&
    ["call_expression", "plain_value", "integer_value", "float_value"].includes(kind(node, ctx))
  )
    return false;
  if (kind(node, ctx) === "call_expression") return true;
  if (kind(prev, ctx) !== "call_expression") return false;
  return kind(node, ctx) !== "plain_value" || t.text(t.child(prev, 0)) !== "$$";
}

/** A number, its unit's case normalized. */
export function number(node: number, ctx: SCtx): void {
  sLiteral(node, unitCase(ctx.tree.text(node)));
}

function plusAfterFunction(node: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  const k = kind(node, ctx);
  if ((k !== "integer_value" && k !== "float_value") || !t.text(node).startsWith("+")) return false;
  const siblings = children(t.parent(node), t);
  const prev = siblings[siblings.indexOf(node) - 1];
  return prev !== undefined && kind(prev, ctx) === "call_expression";
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
  if (outermost) {
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
    const first = kind(c, ctx) === "binary_expression" ? chain(c, ctx)[0] : c;
    return !joinedMath(flat, flat.indexOf(first as number), calc, font, ctx);
  };
  // The fill may break before a `*` or `/` too.
  const breaksBefore = !directive;
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    if (prev !== -1 && !tight && spaced(prev, c)) {
      if (grid) {
        if (breaksBetween(t, prev, c)) sHardline();
        else sText(" ");
      } else if (operators.has(kind(c, ctx)) && !(breaksBefore && ["*", "/"].includes(kind(c, ctx))))
        sText(" ");
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
 * `spaced` says, none before the `;`; a child `own` names prints by its own rule.
 */
function raw(node: number, ctx: SCtx, own: (c: number) => boolean, spaced: (prev: number, c: number) => boolean) {
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    if (prev !== -1 && kind(c, ctx) !== ";" && (spaced(prev, c) || !t.adjoins(prev, c))) sText(" ");
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
  raw(node, ctx, own, (_, c) => kind(c, ctx) === "block");
}

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
 * A Sass list or map (in a directive, or a `$variable`'s value) by `sassList`, else as written without gaps, but a
 * `+`-signed number after a function keeps the source's gap before it.
 */
export function parenthesizedValue(node: number, ctx: SCtx): void {
  if (inDirective(node, ctx) || inVariable(node, ctx)) return sassList(node, ctx);
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (const c of children(node, t)) {
    if (!t.named(c)) sToken(c, t.text(c));
    else if (items.has(c)) {
      // Such a `+2` stays as written: after a space only where the source has a gap.
      if (plusAfterFunction(c, ctx) && !t.adjoins(prev, c)) sText(" ");
      ctx.print(c);
    }
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
const handleComment: CommentHandler<CssOptions> = ({ tree, enclosing, preceding, following, placement, text }) => {
  if ((tree.kindName(enclosing) === "import_statement" || valueArguments(tree, enclosing)) && text.startsWith("/*"))
    return { node: enclosing, as: "dangling" };
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

/** Postcss's `between` of `declaration`, the dangling comments before its value (`handleComment`). */
function between(node: number, ctx: SCtx): number[] {
  const t = ctx.tree;
  const value = children(node, t).find((c) => t.named(c) && !isComment(c, ctx) && kind(c, ctx) !== "property_name");
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

/**
 * A Sass variable's or custom property's value kept as written: one holding a `( … )` group anywhere
 * (`$map: (a: 1)`, `foo( (1, 2) )`), or a `{ … }` outside any function (`[1, {"a":1}]`, `function(x) { … }`).
 */
function rawValue(decl: number, ctx: SCtx): boolean {
  const t = ctx.tree;
  if (!/^(\$|--)/.test(t.text(t.child(decl, 0)))) return false;
  const raw = (n: number, inCall: boolean): boolean =>
    children(n, t).some((c) => {
      const k = kind(c, ctx);
      if (k === "parenthesized_value" || (k === "brace_value" && !inCall)) return true;
      return raw(c, inCall || k === "call_expression");
    });
  return raw(decl, false);
}

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
  const parts = code(node, ctx);
  declarationColon(colon, node, ctx);
  const from = colon === undefined ? 1 : parts.indexOf(colon) + 1;
  // `!important` and Sass flags (`sassFlags`) one space after the value.
  const flag = (c: number) => kind(c, ctx) === "important" || kind(c, ctx) === "ERROR";
  const value = parts.slice(from).filter((c) => kind(c, ctx) !== ";" && !flag(c));
  let prev = -1;
  for (const c of value) {
    sLiteral(c, (prev === -1 ? " " : gapBefore(prev, c, t)) + t.text(c));
    prev = c;
  }
  for (const c of parts.filter(flag)) {
    sText(" ");
    ctx.print(c);
  }
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
    lineComments: { js_comment: "//" },
    defaults,
    settings: prettierSettings,
    normalize,
    handleComment,
    layoutBlind: true,
  }),
  stream: {
    ...cssStream,
    rules: new Map([...cssStream.rules, ["ERROR", sassFlagList]]),
    wrap: frontMatterFirst,
    commentEndsLine: statementComment,
    keepsSource: prettierIgnored,
    recovered: sassFlags,
    finalLine,
  },
};
