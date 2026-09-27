import { NO_NODE } from "../../../core/arena.js";
import {
  brokenOf,
  contentsOf,
  type Doc,
  fill,
  flatOf,
  group,
  hardline,
  ifBreak,
  indent,
  isBroken,
  isDocs,
  isHardLine,
  isSoftLine,
  join,
  kindOf,
  partsOf,
  softline,
  statesOf,
  synthetic,
  text,
  textOf,
  token,
  withContents,
} from "../../../fmt/doc.js";
import type { PrettierOptions } from "../../../fmt/options.js";
import type { Ctx, PrintArgs, Rule } from "../../../fmt/rules.js";
import { lfAfter } from "../../../fmt/text.js";
import type { FormatTree } from "../../../fmt/tree.js";

/** The prettier options its JavaScript and TypeScript printers read, by prettier's names. */
export interface JsOptions extends PrettierOptions {
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

export type JsCtx = Ctx<JsOptions>;
export type JsRule = Rule<string, JsOptions>;
export type Args = PrintArgs | undefined;

/**
 * Whatever carries the tree being formatted: a rule's ctx, or a comment handler's context. A node is a handle
 * into it, `undefined` where there is none; handle 0 is a real node, so a handle is never tested for truthiness.
 */
export interface HasTree {
  readonly tree: FormatTree;
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

/** `n` printed as its source text, as one token. */
export const verbatim = (x: HasTree, n: number): Doc => token(n, src(x, n));

export const field = (x: HasTree, n: number, name: string) =>
  childWhere(x, n, (c) => x.tree.fieldName(c) === name);

export const fields = (x: HasTree, n: number, name: string) =>
  children(x, n).filter((c) => x.tree.fieldName(c) === name);

/** The anonymous token `text` among `n`'s children. */
export const anon = (x: HasTree, n: number, text: string) =>
  childWhere(x, n, (c) => !x.tree.named(c) && x.tree.kindName(c) === text);

/** The anonymous token `text` of `n` printed as itself, or nothing when `n` has none. */
export function tok(ctx: JsCtx, n: number, text: string): Doc {
  const c = anon(ctx, n, text);
  return c !== undefined ? token(c, src(ctx, c)) : [];
}

/** The `;` ending statement `n`: its own when the source has one, else inserted, or dropped when `semi` is off. */
export function semi(ctx: JsCtx, n: number, own?: number): Doc {
  const c =
    own ??
    lastChildWhere(
      ctx,
      n,
      (c) => !ctx.tree.named(c) && ctx.tree.kindName(c) === ";",
    );
  const present = c !== undefined && src(ctx, c) !== "";
  if (!ctx.options.semi) return present ? token(c, "") : [];
  return present ? token(c, ";") : synthetic(n, ";");
}

export const isComment = (x: HasTree, n: number) => {
  const k = x.tree.kindName(n);
  return k === "comment" || k === "html_comment";
};

/** `n`'s first named child that is no comment. */
export const first = (x: HasTree, n: number) =>
  childWhere(x, n, (c) => x.tree.named(c) && !isComment(x, c));

/** Through the parentheses around an expression, to the expression. */
export function unparen(x: HasTree, n: number): number {
  while (x.tree.kindName(n) === "parenthesized_expression") {
    const inner = first(x, n);
    if (inner === undefined) return n;
    n = inner;
  }
  return n;
}

/** The outermost parenthesized_expression wrapping `n`, or `n` itself. */
export function outer(x: HasTree, n: number): number {
  for (
    let p = parent(x, n);
    p !== undefined && x.tree.kindName(p) === "parenthesized_expression";
    p = parent(x, p)
  )
    n = p;
  return n;
}

/** Whether `a` and `b` are both present and the same node. */
export const same = (a: number | undefined, b: number | undefined) =>
  a !== undefined && a === b;

/** Prints `node` with its comments; the rule table's rules receive `args`. */
export const p = (ctx: JsCtx, node: number | undefined, args?: PrintArgs) =>
  node !== undefined ? ctx.print(node, args) : [];

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

export const isBlockComment = (ctx: JsCtx, c: number) => !ctx.isLineComment(c);

/** Prettier's canBreak: whether `doc` holds any line. */
export function canBreak(doc: Doc): boolean {
  if (isDocs(doc)) return doc.some(canBreak);
  switch (kindOf(doc)) {
    case "line":
      return true;
    case "group":
      return (
        canBreak(contentsOf(doc)) || (statesOf(doc)?.some(canBreak) ?? false)
      );
    case "indent":
    case "align":
    case "lineSuffix":
      return canBreak(contentsOf(doc));
    case "fill":
      return partsOf(doc).some(canBreak);
    case "ifBreak":
      return canBreak(brokenOf(doc)) || canBreak(flatOf(doc));
    default:
      return false;
  }
}

/** The text `doc` prints when it is only text (prettier's cleanDoc giving a string), else undefined. */
export function docText(doc: Doc): string | undefined {
  if (isDocs(doc)) {
    let out = "";
    for (const d of doc) {
      const t = docText(d);
      if (t === undefined) return undefined;
      out += t;
    }
    return out;
  }
  const kind = kindOf(doc);
  if (kind === "token" || kind === "text") return textOf(doc);
  if (kind === "group" && !statesOf(doc) && !isBroken(doc))
    return docText(contentsOf(doc));
  return undefined;
}

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
  if (ctx.isLineComment(c)) return false;
  const raw = src(ctx, c);
  if (!raw.startsWith("/*") || !raw.includes("\n")) return false;
  return `*${raw.slice(2, -2)}*`
    .split("\n")
    .every((l) => l.trimStart().startsWith("*"));
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

/** `c` printed as the token it is, or as `as` when given (a keyword respelled, a separator dropped with ""). */
export const t = (ctx: JsCtx, c: number | undefined, as?: string): Doc =>
  c !== undefined ? token(c, as ?? src(ctx, c)) : [];

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

/** Prettier's isConciselyPrintedArray: a non-empty array of numbers, printed as a fill. */
export function isConciselyPrintedArray(ctx: JsCtx, n: number): boolean {
  if (kind(ctx, n) !== "array") return false;
  const elements = items(ctx, n);
  return (
    elements.length > 0 &&
    elements.every(
      (e) =>
        isSignedNumber(ctx, e) &&
        !hasComment(ctx, e, CF.Trailing | CF.Line, (c) => ctx.tree.lf(c) === 0),
    )
  );
}

/** Prettier's printDanglingComments: `n`'s dangling comments one per line, optionally indented on their own line. */
export function danglingComments(ctx: JsCtx, n: number, indented = false): Doc {
  const docs = ctx.dangling(n);
  if (docs.length === 0) return [];
  const doc = join(hardline, docs);
  return indented ? indent([hardline, doc]) : doc;
}

/** Prettier's printDanglingCommentsInList. */
export function danglingCommentsInList(ctx: JsCtx, n: number): Doc {
  const docs = ctx.dangling(n);
  if (docs.length === 0) return [];
  return [
    indent([softline, join(hardline, docs)]),
    ctx.hasDanglingLineComment(n) ? hardline : softline,
  ];
}

/** Prettier's shouldPrintTrailingComma. */
export const trailingCommaAllowed = (
  ctx: JsCtx,
  level: "es5" | "all" = "es5",
) =>
  level === "all"
    ? ctx.options.trailingComma === "all"
    : ctx.options.trailingComma !== "none";

/** A trailing `,` when the enclosing group breaks and `trailingComma` allows it, anchored to `last`. */
export const trailingComma = (
  ctx: JsCtx,
  last: number | undefined,
  level: "es5" | "all" = "es5",
): Doc =>
  last !== undefined && trailingCommaAllowed(ctx, level)
    ? ifBreak(synthetic(last, ","))
    : [];

/** Prettier's removeLines: every soft or plain line printed flat, every group unbroken. Hard lines stay. */
export function removeLines(doc: Doc): Doc {
  if (isDocs(doc)) return doc.map(removeLines);
  switch (kindOf(doc)) {
    case "line":
      return isHardLine(doc) ? doc : isSoftLine(doc) ? [] : text(" ");
    case "group": {
      const states = statesOf(doc);
      return states
        ? removeLines(states.at(-1) as Doc)
        : group(removeLines(contentsOf(doc)));
    }
    case "indent":
    case "align":
    case "lineSuffix":
      return withContents(doc, removeLines(contentsOf(doc)));
    case "fill":
      return fill(partsOf(doc).map(removeLines));
    case "ifBreak":
      return removeLines(flatOf(doc));
    default:
      return doc;
  }
}
