import { NO_NODE, type Tree } from "../../core/arena.js";
import { decimalValue, type Normalize } from "../../fmt/check.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import type { CommentHandler } from "../../fmt/comments.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { atName, maybeLower, numberParts } from "../../fmt/dsl/normalizers.js";
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
// does an empty statement's (`a: b;;`), which postcss drops.
const normalize: Normalize = (lexemes, _text, tree) =>
  lexemes.map((l, i) => {
    const next = lexemes[i + 1]?.text;
    const prev = lexemes[i - 1]?.text;
    if (l.text === ";" && (next === undefined || next === "}" || next === ";" || prev === "{"))
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
  /** A declaration with nothing between its `:` and its `;` (`--empty:;`). */
  emptyValue: (node, ctx) => code(node, ctx).every((c) => !ctx.tree.named(c) || kind(c, ctx) === "property_name"),
  unparsedValue: (node, ctx) => unparsedUrl(node, ctx),
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

/**
 * Whether prettier's printCommaSeparatedValueGroup joins the neighbours `chain[i - 1]` and `chain[i]` of a math chain.
 * Outside `calc()`, a `/` or `+` written without a gap before its right side stays joined unless a function or a word
 * sits beside it, and a `-` so written always; a `*` is always spaced. In `font` and custom properties, a `/` written
 * without a gap after a number or a math function stays joined, and so does what follows it, even inside `calc()`.
 */
function joinedMath(chain: number[], i: number, calc: boolean, font: boolean, ctx: SCtx): boolean {
  const t = ctx.tree;
  const [y, g, v, w] = [chain[i - 2], chain[i - 1] as number, chain[i] as number, chain[i + 1]];
  const op = (n: number | undefined, o: string) => n !== undefined && kind(n, ctx) === o;
  const tight = t.adjoins(g, v);
  if (isOperator(v, ctx)) {
    if (font && op(v, "/") && tight && fontOperand(g, ctx)) return true;
    const spaced = funcOrWord(w, ctx) || funcOrWord(g, ctx);
    return !calc && tight && (op(v, "-") || ((op(v, "/") || op(v, "+")) && !spaced));
  }
  if (font && op(g, "/") && y !== undefined && t.adjoins(y, g) && fontOperand(y, ctx)) return true;
  const spaced = funcOrWord(v, ctx) || funcOrWord(y, ctx);
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
  const items = new Set(ctx.items(node));
  let prev = -1;
  for (const c of children(node, t)) {
    const named = t.named(c);
    if (named && !items.has(c)) continue;
    if (prev !== -1 && !tight && spaced(prev, c)) {
      if (grid) {
        if (breaksBetween(t, prev, c)) sHardline();
        else sText(" ");
      } else if (operators.has(kind(c, ctx))) sText(" ");
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

/** A Sass list or map (in a directive, or a `$variable`'s value) by `sassList`, else as written without gaps. */
export function parenthesizedValue(node: number, ctx: SCtx): void {
  if (inDirective(node, ctx) || inVariable(node, ctx)) return sassList(node, ctx);
  const t = ctx.tree;
  const items = new Set(ctx.items(node));
  for (const c of children(node, t))
    if (!t.named(c)) sToken(c, t.text(c));
    else if (items.has(c)) ctx.print(c);
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
 * attach to the declaration (`handleComment`) for `declarationColon` to print. Among statements, postcss's comment
 * is a statement of its own: one that starts the line the statement before it ends trails that statement.
 */
const handleComment: CommentHandler<CssOptions> = ({ tree, enclosing, preceding, placement }) => {
  if (preceding === undefined) return undefined;
  if (statementSequences.has(tree.kindName(enclosing)) && placement !== "ownLine")
    return { node: preceding, as: "trailing" };
  return tree.kindName(enclosing) === "declaration" &&
    tree.kindName(preceding) === "property_name" &&
    !/:\s*progid:/i.test(tree.text(enclosing))
    ? { node: enclosing, as: "dangling" }
    : undefined;
};

/** The nodes whose children prettier prints as a sequence of statements (printNodeSequence). */
const statementSequences = new Set([...statementLists, "keyframe_block_list"]);

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
 * trimmed: the first joined to the name, each later one joined to what precedes it where the source joins them, else
 * after a space, or on a line of its own where the source breaks.
 */
export function declarationColon(colon: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  const between = ctx.danglingComments(node);
  if (colon === undefined) return sToken(node, ":", true);
  // Postcss's `between` starts right after the name, trimmed.
  let prev = -1;
  const put = (c: number, print: () => void) => {
    if (prev !== -1 && t.lf(c) > 0) sHardline();
    else if (prev !== -1 && !t.adjoins(prev, c)) sText(" ");
    print();
    prev = c;
  };
  open(INDENT);
  for (const c of between) if (t.ord(c) < t.ord(colon)) put(c, () => ctx.comment(c));
  put(colon, () => sToken(colon, ":"));
  for (const c of between) if (t.ord(c) > t.ord(colon)) put(c, () => ctx.comment(c));
  close();
}

/**
 * A declaration's `;`, the source's or one of its own. After an empty value (`--empty:  ;`) prettier keeps the gap
 * before it as written, postcss's raw value: one space where the gap holds a line break or a comment; after a comment
 * of the `between` (`declarationColon`), the gap past that comment.
 */
export function declarationEnd(semi: number | undefined, node: number, ctx: SCtx): void {
  const t = ctx.tree;
  if (semi === undefined || t.text(semi) === "") return sToken(node, ";", true);
  const colon = code(node, ctx).find((c) => kind(c, ctx) === ":");
  const last = colon === undefined ? undefined : ctx.danglingComments(node).filter((c) => t.ord(c) > t.ord(colon)).at(-1);
  if (colon !== undefined && customs.emptyValue(node, ctx) && !t.adjoins(last ?? colon, semi)) {
    const plain = t.lf(semi) === 0 && code(node, ctx).length === t.count(node);
    sText(plain ? " ".repeat(t.col(semi) - t.col(colon) - 1) : " ");
  }
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
  const value = parts.slice(from).filter((c) => kind(c, ctx) !== ";" && kind(c, ctx) !== "important");
  let prev = -1;
  for (const c of value) {
    sLiteral(c, (prev === -1 ? " " : gapBefore(prev, c, t)) + t.text(c));
    prev = c;
  }
  const important = parts.find((c) => kind(c, ctx) === "important");
  if (important !== undefined) {
    sText(" ");
    ctx.print(important);
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
  const item = (c: number) => (t.named(c) ? ctx.print(c) : sToken(c, t.text(c)));
  const run = splitRun(ctx, node, ",", ["@import", ";"], ["block"]);
  open(GROUP);
  open(INDENT);
  run.entries.forEach((e, i) => {
    if (i > 0) sLine(0);
    open(FILL);
    e.items.forEach((c, j) => {
      if (j > 0) sLine(0);
      open(FILL_ITEM);
      item(c);
      close();
    });
    close();
    if (e.sep !== -1) sToken(e.sep, t.text(e.sep));
  });
  close();
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

/** The hand-written rules format.ts names. */
export const handWritten = {
  ...customs,
  important,
  declarationColon,
  declarationEnd,
  colonThenSource,
  importStatement,
  valueMath,
  atRule,
  postcssStatement,
  parenthesizedValue,
  keywordArgument,
  sassList,
};

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
    ...gen.css(handWritten),
    wrap: frontMatterFirst,
    commentEndsLine: statementComment,
    keepsSource: prettierIgnored,
    finalLine,
  },
};
