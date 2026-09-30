import { NO_NODE } from "../../../core/arena.js";
import type { Comments } from "../../../fmt/comments.js";
import type { CompatOptions, PrettierOptions } from "../../../fmt/options.js";
import type { PrintArgs } from "../../../fmt/rules.js";
import { lfAfter } from "../../../fmt/text.js";
import { type FormatTree, nextLeaf, prevLeaf } from "../../../fmt/tree.js";

/** The prettier options its JavaScript and TypeScript printers read, by prettier's names. */
export interface JsOptions extends PrettierOptions, CompatOptions {
  semi: boolean;
  singleQuote: boolean;
  jsxSingleQuote: boolean;
  quoteProps: "as-needed" | "consistent" | "preserve";
  trailingComma: "all" | "es5" | "none";
  bracketSameLine: boolean;
  arrowParens: "always" | "avoid";
  /** Where a broken binary expression puts its operator: ending the line, or starting the next. */
  experimentalOperatorPosition: "end" | "start";
  experimentalTernaries: boolean;
  /** Which of prettier's parsers this formatter stands in for: a few decisions differ for TypeScript. */
  parser: "babel" | "typescript";
}

/** The tree queries the JS helpers read: the format's tree, its options, and where its comments attach. */
export interface JsCtx extends HasTree {
  readonly options: JsOptions;
  readonly placement: Comments;
  items(node: number): number[];
  comments(node: number): {
    readonly leading: readonly number[];
    readonly trailing: readonly number[];
    readonly dangling: readonly number[];
  };
  isLineComment(c: number): boolean;
  isList(node: number): boolean;
  hasComment(node: number, where: "leadingLine" | "trailingSameLine"): boolean;
  hasDanglingLineComment(node: number): boolean;
}
export type Args = PrintArgs | undefined;

/**
 * Whatever carries the tree being formatted: a rule's ctx, or a comment handler's context. A node is a handle
 * into it, `undefined` where there is none; handle 0 is a real node, so a handle is never tested for truthiness.
 */
export interface HasTree {
  readonly tree: FormatTree;
  readonly options: Pick<JsOptions, "parser">;
}

export function kind(x: HasTree, n: number): string;
export function kind(x: HasTree, n: number | undefined): string | undefined;
export function kind(x: HasTree, n: number | undefined): string | undefined {
  return n === undefined ? undefined : x.tree.kindName(n);
}

/** False for anonymous tokens the grammar spells literally (punctuation, keywords). */
export const named = (x: HasTree, n: number) => x.tree.named(n);

/** The field `n` fills in its parent. */
export const fieldName = (x: HasTree, n: number) => x.tree.fieldName(n);

/** The enclosing node; undefined at the root, as for no node. */
export function parent(x: HasTree, n: number | undefined): number | undefined {
  if (n === undefined) return undefined;
  const p = x.tree.parent(n);
  return p === NO_NODE ? undefined : p;
}

/** `n`'s children in source order, as a fresh array. */
export function children(x: HasTree, n: number): number[] {
  const { tree } = x;
  const count = tree.count(n);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(tree.child(n, i));
  return out;
}

/**
 * TypeScript takes a class member's or parameter property's modifiers in any order; prettier prints them in
 * this one. check's normalize (normalize.ts) reads the same order, so the two must change together.
 */
export const MODIFIER_ORDER = [
  "declare",
  "accessibility_modifier",
  "static",
  "abstract",
  "override_modifier",
  "readonly",
  "accessor",
];

/** `kids` with its modifiers in prettier's order; anything else (`async`, `get`, `*`) keeps its place after them. */
export function inModifierOrder(x: HasTree, kids: readonly number[]): number[] {
  const rank = (c: number) => {
    const r = MODIFIER_ORDER.indexOf(kind(x, c));
    return r < 0 ? MODIFIER_ORDER.length : r;
  };
  return [...kids].sort((a, b) => rank(a) - rank(b));
}

/** The first child of `n` that passes `is`. */
export function childWhere(
  x: HasTree,
  n: number,
  is: (c: number) => boolean,
): number | undefined {
  const { tree } = x;
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (is(c)) return c;
  }
  return undefined;
}

/** The last child of `n` that passes `is`. */
export function lastChildWhere(
  x: HasTree,
  n: number,
  is: (c: number) => boolean,
): number | undefined {
  const { tree } = x;
  for (let i = tree.count(n) - 1; i >= 0; i--) {
    const c = tree.child(n, i);
    if (is(c)) return c;
  }
  return undefined;
}

/** The source `n` spans. */
export const src = (x: HasTree, n: number) => x.tree.text(n);

export const field = (x: HasTree, n: number, name: string) =>
  childWhere(x, n, (c) => x.tree.fieldName(c) === name);

export const fields = (x: HasTree, n: number, name: string) =>
  children(x, n).filter((c) => x.tree.fieldName(c) === name);

/** The anonymous token `text` among `n`'s children. */
export const anon = (x: HasTree, n: number, text: string) =>
  childWhere(x, n, (c) => !x.tree.named(c) && x.tree.kindName(c) === text);

export const isComment = (x: HasTree, n: number) => {
  const k = x.tree.kindName(n);
  return k === "comment" || k === "html_comment";
};

/** `n`'s first named child that is no comment. */
export const first = (x: HasTree, n: number) =>
  childWhere(x, n, (c) => x.tree.named(c) && !isComment(x, c));

/** Prettier's isTypeCastComment: a `/**` block comment naming `@type` or `@satisfies`, the Closure type cast. */
export const isTypeCastComment = (x: HasTree, c: number) => {
  if (kind(x, c) !== "comment") return false;
  const text = src(x, c);
  return text.startsWith("/**") && text.endsWith("*/") && /@(?:type|satisfies)\b/.test(text);
};

/** The statements whose `(...)` tree-sitter parses as a parenthesized_expression though it is their own syntax. */
const OWN_PARENS = new Set(["if_statement", "while_statement", "do_statement", "switch_statement", "with_statement"]);

/**
 * Parentheses prettier keeps as a node of their own (babel's ParenthesizedExpression, which its postprocess keeps
 * only here): those right after a type cast comment, `/** @type {T} *\/ (x)`, whose cast they delimit. Prettier's
 * TypeScript parser has no such node.
 */
export function isCastParen(x: HasTree, n: number): boolean {
  if (x.options.parser === "typescript" || x.tree.kindName(n) !== "parenthesized_expression") return false;
  if (OWN_PARENS.has(kind(x, parent(x, n)) ?? "")) return false;
  const before = prevLeaf(x.tree, n);
  return before !== NO_NODE && isTypeCastComment(x, before);
}

/** Through the parentheses around an expression, to the expression: to a type cast's parentheses at most. */
export function unparen(x: HasTree, n: number): number {
  while (x.tree.kindName(n) === "parenthesized_expression" && !isCastParen(x, n)) {
    const inner = first(x, n);
    if (inner === undefined) return n;
    n = inner;
  }
  return n;
}

/** Through parentheses and non-null assertions: `(f(x)!)!` to `f(x)`. */
export function unassert(x: HasTree, n: number): number {
  n = unparen(x, n);
  while (x.tree.kindName(n) === "non_null_expression") {
    const inner = first(x, n);
    if (inner === undefined) return n;
    n = unparen(x, inner);
  }
  return n;
}

/** The outermost parenthesized_expression wrapping `n` below any type cast's parentheses, or `n` itself. */
export function outer(x: HasTree, n: number): number {
  for (
    let p = parent(x, n);
    p !== undefined && x.tree.kindName(p) === "parenthesized_expression" && !isCastParen(x, p);
    p = parent(x, p)
  )
    n = p;
  return n;
}

/** Whether `a` and `b` are both present and the same node. */
export const same = (a: number | undefined, b: number | undefined) =>
  a !== undefined && a === b;

export const STRING_KINDS = new Set(["string", "template_string"]);

export const FUNCTION_KINDS = new Set([
  "function_expression",
  "function_declaration",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
]);

export const CALL_KINDS = new Set(["call_expression", "new_expression"]);
export const MEMBER_KINDS = new Set([
  "member_expression",
  "subscript_expression",
]);

export const OBJECT_KINDS = new Set([
  "object",
  "object_pattern",
  "object_type",
]);
export const ARRAY_KINDS = new Set(["array", "array_pattern", "tuple_type"]);

export const isCall = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "call_expression" &&
  kind(x, field(x, n as number, "arguments")) === "arguments";

/** A tagged template: tree-sitter's call_expression whose arguments are a template string. */
export const isTaggedTemplate = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "call_expression" &&
  kind(x, field(x, n as number, "arguments")) === "template_string";

export const isMember = (x: HasTree, n: number | undefined) =>
  n !== undefined && MEMBER_KINDS.has(kind(x, n));

/** A `?.`: tree-sitter-typescript leaves the one of an optional call an anonymous token. */
export const isOptionalChainToken = (x: HasTree, c: number) => {
  const k = kind(x, c);
  return k === "optional_chain" || k === "?.";
};

export const isOptional = (x: HasTree, n: number) =>
  childWhere(x, n, (c) => isOptionalChainToken(x, c)) !== undefined;

/** The object of a member, the callee of a call, the tag of a tagged template. */
export const callee = (x: HasTree, n: number) =>
  field(x, n, "function") ?? field(x, n, "constructor");

export const objectOf = (x: HasTree, n: number) => field(x, n, "object");

/** The single argument of a unary-shaped node (await, spread, yield, unary), which tree-sitter puts in no field. */
export const argument = (x: HasTree, n: number) =>
  field(x, n, "argument") ?? first(x, n);

/** The arguments of a call or new expression, without comments. */
export function callArguments(x: HasTree, n: number): number[] {
  const args = field(x, n, "arguments");
  if (args === undefined || kind(x, args) !== "arguments") return [];
  return items(x, args);
}

export const isStringLiteral = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "string";

export const isTemplate = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "template_string";

const SIMPLE_TYPE_KINDS = new Set([
  "type_identifier",
  "nested_type_identifier",
  "this_type",
  "literal_type",
  "template_literal_type",
]);

/** Prettier's isSimpleType: a keyword, literal or template literal type, or a reference without type arguments. */
export const isSimpleType = (x: HasTree, n: number | undefined) =>
  n !== undefined &&
  (SIMPLE_TYPE_KINDS.has(kind(x, n)) ||
    (kind(x, n) === "predefined_type" && !src(x, n).startsWith("unique")));

const LITERAL_KINDS = new Set([
  "string",
  "number",
  "true",
  "false",
  "null",
  "undefined",
  "regex",
]);

export const isLiteral = (x: HasTree, n: number | undefined) =>
  n !== undefined && LITERAL_KINDS.has(kind(x, n));

export const isSimpleTemplate = (x: HasTree, n: number) =>
  kind(x, n) === "template_string" &&
  children(x, n)
    .filter((c) => kind(x, c) === "template_substitution")
    .every((s) => {
      const e = first(x, s);
      if (e === undefined || src(x, s).includes("\n")) return false;
      const k = kind(x, e);
      return (
        k === "identifier" ||
        k === "this" ||
        (isMember(x, e) && isSimpleMemberChain(x, e))
      );
    });

function isSimpleMemberChain(x: HasTree, n: number): boolean {
  for (let c: number | undefined = n; c !== undefined; c = objectOf(x, c)) {
    const k = kind(x, c);
    if (k === "identifier" || k === "this") return true;
    if (k !== "member_expression") return false;
    if (kind(x, field(x, c, "property")) !== "property_identifier")
      return false;
  }
  return false;
}

const JEST_EACH_TRIGGER = /^[fx]?(?:describe|it|test)$/;

function fieldChild(tree: FormatTree, n: number, name: string): number {
  for (let i = 0; i < tree.count(n); i++) {
    const c = tree.child(n, i);
    if (tree.fieldName(c) === name) return c;
  }
  return NO_NODE;
}

/** The object of member expression `n` (not an optional chain, as prettier's MemberExpression) whose property matches `names`. */
function eachOf(tree: FormatTree, n: number, names: RegExp): number {
  if (n === NO_NODE || tree.kindName(n) !== "member_expression") return NO_NODE;
  for (let i = 0; i < tree.count(n); i++)
    if (tree.kindName(tree.child(n, i)) === "optional_chain") return NO_NODE;
  const property = fieldChild(tree, n, "property");
  if (property === NO_NODE || tree.kindName(property) !== "property_identifier")
    return NO_NODE;
  return names.test(tree.text(property)) ? fieldChild(tree, n, "object") : NO_NODE;
}

const isTrigger = (tree: FormatTree, n: number) =>
  n !== NO_NODE &&
  tree.kindName(n) === "identifier" &&
  JEST_EACH_TRIGGER.test(tree.text(n));

/**
 * Prettier's isJestEachTemplateLiteral: `template` is the table of `describe.each`, `it.only.each`, `xtest.skip.each`
 * and the like, which prettier reprints as an aligned table. check's normalize (normalize.ts) reads its text so.
 */
export function isJestEachTemplate(tree: FormatTree, template: number): boolean {
  const call = tree.parent(template);
  if (
    call === NO_NODE ||
    tree.kindName(call) !== "call_expression" ||
    tree.fieldName(template) !== "arguments"
  )
    return false;
  const object = eachOf(tree, fieldChild(tree, call, "function"), /^each$/);
  if (isTrigger(tree, object)) return true;
  return isTrigger(tree, eachOf(tree, object, /^(?:only|skip)$/));
}

/** A template string's language, which print/embed.ts formats in place of its text. */
export type EmbedLanguage = "css" | "graphql" | "html";

/** The sibling before `n` in its parent, else NO_NODE. */
function prevSibling(tree: FormatTree, n: number): number {
  const p = tree.parent(n);
  if (p === NO_NODE) return NO_NODE;
  let prev = NO_NODE;
  for (let i = 0; i < tree.count(p); i++) {
    const c = tree.child(p, i);
    if (c === n) return prev;
    prev = c;
  }
  return NO_NODE;
}

/** Prettier's hasLanguageComment: a `/* HTML *\/` block comment just before `n` or its expression statement. */
function hasLanguageComment(tree: FormatTree, n: number, name: string): boolean {
  const named = (m: number) => {
    const c = prevSibling(tree, m);
    return c !== NO_NODE && tree.kindName(c) === "comment" && tree.text(c) === `/* ${name} */`;
  };
  if (named(n)) return true;
  const p = tree.parent(n);
  return p !== NO_NODE && tree.kindName(p) === "expression_statement" && named(p);
}

/**
 * The language prettier's embed (language-js/embed/) formats `template` as: `html`, `css` (styled-jsx's `css`,
 * `css.global` and `css.resolve`; styled-components' other tags print as plain templates here) or `gql`/`graphql`
 * tagged, or marked by a language comment. check's normalize (normalize.ts) reads its text so.
 */
export function embedLanguage(tree: FormatTree, template: number): EmbedLanguage | undefined {
  if (tree.kindName(template) !== "template_string") return undefined;
  const call = tree.parent(template);
  let tag = "";
  if (call !== NO_NODE && tree.kindName(call) === "call_expression" && tree.fieldName(template) === "arguments") {
    const fn = fieldChild(tree, call, "function");
    const k = fn === NO_NODE ? "" : tree.kindName(fn);
    if (k === "identifier" || k === "member_expression") tag = tree.text(fn);
  }
  if (tag === "css" || tag === "css.global" || tag === "css.resolve") return "css";
  if (tag === "gql" || tag === "graphql" || tag === "graphql.experimental" || hasLanguageComment(tree, template, "GraphQL"))
    return "graphql";
  if (tag === "html" || hasLanguageComment(tree, template, "HTML")) return "html";
  return undefined;
}

/** Prettier's `options.__inJestEach`: set while a jest `each` table prints its cells. */
export const jestEach = { printing: false };

export const hasNewlineIn = (x: HasTree, n: number) => src(x, n).includes("\n");

const TYPE_ANNOTATIONS = new Set([
  "type_annotation",
  "opting_type_annotation",
  "omitting_type_annotation",
  "adding_type_annotation",
]);

/** The TS type annotation child (`: T`) of a declarator, parameter or property. */
export const typeAnnotation = (x: HasTree, n: number) =>
  childWhere(x, n, (c) => TYPE_ANNOTATIONS.has(kind(x, c)));

export const noArgs: Args = undefined;

/** A statement's own separator children that its rule prints (a class member's `;` sits in the body). */
export const isSemicolon = (x: HasTree, n: number) =>
  !named(x, n) && kind(x, n) === ";";

/** Prettier's CommentCheckFlags (utilities/comments.js), over `Ctx.comments`. */
export const CF = {
  Leading: 1 << 1,
  Trailing: 1 << 2,
  Dangling: 1 << 3,
  Block: 1 << 4,
  Line: 1 << 5,
  First: 1 << 7,
  Last: 1 << 8,
} as const;

/** `n`'s attached comments in source order that pass `flags` and `fn`, as prettier's getComments. */
export function getComments(
  ctx: JsCtx,
  n: number | undefined,
  flags = 0,
  fn?: (c: number) => boolean,
): number[] {
  if (n === undefined) return [];
  const { leading, trailing, dangling } = ctx.comments(n);
  const total = leading.length + trailing.length + dangling.length;
  if (total === 0) return [];
  const out: number[] = [];
  let i = 0;
  const test = (c: number, kind: number) => {
    const index = i++;
    if (flags & (CF.Leading | CF.Trailing | CF.Dangling) && !(flags & kind))
      return;
    const line = ctx.isLineComment(c);
    if (flags & CF.Block && line) return;
    if (flags & CF.Line && !line) return;
    if (flags & CF.First && index !== 0) return;
    if (flags & CF.Last && index !== total - 1) return;
    if (fn && !fn(c)) return;
    out.push(c);
  };
  for (const c of leading) test(c, CF.Leading);
  for (const c of dangling) test(c, CF.Dangling);
  for (const c of trailing) test(c, CF.Trailing);
  return out;
}

export const hasComment = (
  ctx: JsCtx,
  n: number | undefined,
  flags = 0,
  fn?: (c: number) => boolean,
) => getComments(ctx, n, flags, fn).length > 0;

/**
 * Prettier's hasComment for the expression `n`, whose parentheses its AST lacks: tree-sitter attaches a comment
 * between two pairs of them, `!(\n// c\n(a || b))`, to the inner pair.
 */
export function hasCommentThroughParens(ctx: JsCtx, n: number): boolean {
  for (let m: number | undefined = outer(ctx, n); m !== undefined; ) {
    if (hasComment(ctx, m)) return true;
    if (ctx.tree.kindName(m) !== "parenthesized_expression" || isCastParen(ctx, m)) return false;
    m = first(ctx, m);
  }
  return false;
}

export const isBlockComment = (ctx: JsCtx, c: number) => !ctx.isLineComment(c);

const IGNORE = /^(?:\/\/|\/\*)\s*prettier-ignore\s*(?:\*\/)?$/;

/** Whether comment `c` is a `// prettier-ignore` or `/* prettier-ignore *\/`. */
export const isIgnoreComment = (x: HasTree, c: number) =>
  IGNORE.test(src(x, c).trimEnd());

/** Prettier's hasLeadingOwnLineComment: a JSX element counts only an ignore comment, which it prints above itself. */
export const hasLeadingOwnLineComment = (ctx: JsCtx, n: number) =>
  isJsx(ctx, n)
    ? hasComment(ctx, n, 0, (c) => isIgnoreComment(ctx, c))
    : hasComment(ctx, n, CF.Leading, (c) => lfAfter(ctx.tree, c) > 0);

/** Prettier's isIndentableBlockComment: a multi-line block comment whose lines all start with `*`. */
export function isIndentableBlockComment(ctx: JsCtx, c: number): boolean {
  return !ctx.isLineComment(c) && indentable(src(ctx, c));
}

const indentable = (raw: string) =>
  raw.startsWith("/*") &&
  raw.includes("\n") &&
  `*${raw.slice(2, -2)}*`.split("\n").every((l) => l.trimStart().startsWith("*"));

/**
 * The comment prettier's parsers (babel's and typescript's postprocess) merge onto comment `c`, so the two print
 * as one: an indentable block comment that starts right where `c`, itself one, ends (`*//**`).
 */
export function nestledComment(tree: FormatTree, c: number): number | undefined {
  const next = nextLeaf(tree, c);
  if (next === NO_NODE || tree.kindName(next) !== "comment" || !tree.adjoins(c, next)) return undefined;
  return indentable(tree.text(c)) && indentable(tree.text(next)) ? next : undefined;
}

/** Whether comment `c` is merged onto the one before it (`nestledComment`), which prints it. */
export function isNestledComment(tree: FormatTree, c: number): boolean {
  const prev = prevLeaf(tree, c);
  return prev !== NO_NODE && tree.kindName(prev) === "comment" && nestledComment(tree, prev) === c;
}

export const LOGICAL_OPERATORS = new Set(["&&", "||", "??"]);
export const operator = (x: HasTree, n: number) =>
  kind(x, field(x, n, "operator")) ?? "";
export const isBinaryish = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "binary_expression";
export const isLogical = (x: HasTree, n: number | undefined) =>
  n !== undefined &&
  kind(x, n) === "binary_expression" &&
  LOGICAL_OPERATORS.has(operator(x, n));
export const isAssignment = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return (
    k === "assignment_expression" || k === "augmented_assignment_expression"
  );
};
export const isJsx = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return k === "jsx_element" || k === "jsx_self_closing_element";
};
export const isObjectOrRecord = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "object";
export const isArrayLike = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "array";
export const isBoolean = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return k === "true" || k === "false";
};

/** The named, non-comment children of `n`: its items as prettier's AST would list them. */
export function items(x: HasTree, n: number): number[] {
  const { tree } = x;
  const out: number[] = [];
  for (let i = 0, count = tree.count(n); i < count; i++) {
    const c = tree.child(n, i);
    if (tree.named(c) && !isComment(x, c)) out.push(c);
  }
  return out;
}

/** The anonymous separator `sep` that follows each item of `n`, found in one pass. */
export function separators(
  x: HasTree,
  n: number,
  list: readonly number[],
  sep = ",",
): Map<number, number> {
  const out = new Map<number, number>();
  const isItem = new Set(list);
  let previous: number | undefined;
  for (const c of children(x, n)) {
    if (isItem.has(c)) previous = c;
    else if (
      previous !== undefined &&
      !named(x, c) &&
      kind(x, c) === sep &&
      !out.has(previous)
    )
      out.set(previous, c);
  }
  return out;
}

/** Thrown by a printer asked to hug a call's first or last argument that cannot be hugged; the call breaks all. */
export class ArgExpansionBailout extends Error {
  override readonly name = "ArgExpansionBailout";
}

/** Prettier's FunctionExpression (generators included) or ArrowFunctionExpression. */
export const isFunctionOrArrow = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return (
    k === "function_expression" ||
    k === "generator_function" ||
    k === "arrow_function"
  );
};

/** The parameters of a function, method or arrow (an arrow's lone unparenthesized one included). */
export function parameters(x: HasTree, fn: number): number[] {
  const list = field(x, fn, "parameters");
  if (list !== undefined) return items(x, list);
  const single = field(x, fn, "parameter");
  return single !== undefined ? [single] : [];
}

/** Prettier's node type of `n` for "same type" comparisons, where a generator is a FunctionExpression. */
export const estreeType = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return k === "generator_function" ? "function_expression" : k;
};

/** A number, or a `+`/`-` before a number with no comment between. */
export function isSignedNumber(ctx: JsCtx, n: number): boolean {
  const k = kind(ctx, n);
  if (k === "number") return true;
  if (k !== "unary_expression") return false;
  const op = operator(ctx, n);
  const arg = argument(ctx, n);
  return (
    (op === "+" || op === "-") &&
    kind(ctx, arg) === "number" &&
    !hasComment(ctx, arg)
  );
}

/** The elements of an array, `undefined` for each hole, with the `,` after each. */
export function arrayElements(
  x: HasTree,
  n: number,
): { element: number | undefined; comma: number | undefined }[] {
  const out: {
    element: number | undefined;
    comma: number | undefined;
  }[] = [];
  let expecting = true;
  for (const c of children(x, n)) {
    if (isComment(x, c)) continue;
    if (named(x, c)) {
      out.push({ element: c, comma: undefined });
      expecting = false;
    } else if (kind(x, c) === ",") {
      if (expecting) out.push({ element: undefined, comma: c });
      else {
        const last = out.at(-1);
        if (last) last.comma = c;
      }
      expecting = true;
    }
  }
  return out;
}

/** Prettier's isConciselyPrintedArray: a non-empty array of numbers, printed as a fill; a hole is no number. */
export function isConciselyPrintedArray(ctx: JsCtx, n: number): boolean {
  if (kind(ctx, n) !== "array") return false;
  const elements = arrayElements(ctx, n);
  return (
    elements.length > 0 &&
    elements.every(
      ({ element: e }) =>
        e !== undefined &&
        isSignedNumber(ctx, unparen(ctx, e)) &&
        !hasComment(ctx, e, CF.Trailing | CF.Line, (c) => ctx.tree.lf(c) === 0),
    )
  );
}

/** Prettier's shouldPrintTrailingComma. */
export const trailingCommaAllowed = (
  ctx: JsCtx,
  level: "es5" | "all" = "es5",
) =>
  level === "all"
    ? ctx.options.trailingComma === "all"
    : ctx.options.trailingComma !== "none";
