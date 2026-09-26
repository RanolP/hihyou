import {
  type Doc,
  hardline,
  ifBreak,
  indent,
  isDocs,
  join,
  softline,
  synthetic,
  text,
  token,
} from "../../../fmt/doc.js";
import type { PrettierOptions } from "../../../fmt/options.js";
import type { Ctx, PrintArgs, Rule } from "../../../fmt/legacy.js";
import { hasNewline } from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";

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

export const src = (ctx: JsCtx, n: FormatNode) =>
  ctx.source.slice(n.start, n.end);

/** `n` printed as its source text, as one token. */
export const verbatim = (ctx: JsCtx, n: FormatNode): Doc =>
  token(n, src(ctx, n));

export const field = (n: FormatNode, name: string) =>
  n.children.find((c) => c.field === name);

export const fields = (n: FormatNode, name: string) =>
  n.children.filter((c) => c.field === name);

/** The anonymous token `text` among `n`'s children (the first at or after `from`). */
export const anon = (n: FormatNode, text: string, from = 0) =>
  n.children.find((c) => !c.named && c.kind === text && c.start >= from);

/** The anonymous token `text` of `n` printed as itself, or nothing when `n` has none. */
export function tok(ctx: JsCtx, n: FormatNode, text: string, from = 0): Doc {
  const c = anon(n, text, from);
  return c ? token(c, src(ctx, c)) : [];
}

/** The `;` ending statement `n`: its own when the source has one, else inserted, or dropped when `semi` is off. */
export function semi(ctx: JsCtx, n: FormatNode, own?: FormatNode): Doc {
  const c = own ?? n.children.findLast((c) => !c.named && c.kind === ";");
  const present = c !== undefined && c.end > c.start;
  if (!ctx.options.semi) return present ? token(c, "") : [];
  return present ? token(c, ";") : synthetic(n, ";");
}

export const isComment = (n: FormatNode) =>
  n.kind === "comment" || n.kind === "html_comment";

/** `n`'s first named child that is no comment. */
export const first = (n: FormatNode) =>
  n.children.find((c) => c.named && !isComment(c));

/** Through the parentheses around an expression, to the expression. */
export function unparen(n: FormatNode): FormatNode {
  while (n.kind === "parenthesized_expression") {
    const inner = first(n);
    if (!inner) return n;
    n = inner;
  }
  return n;
}

/** The outermost parenthesized_expression wrapping `n`, or `n` itself. */
export function outer(n: FormatNode): FormatNode {
  while (n.parent?.kind === "parenthesized_expression") n = n.parent;
  return n;
}

/** Whether `a` and `b` are both present and the same node. */
export const same = (a: FormatNode | undefined, b: FormatNode | undefined) =>
  a !== undefined && a === b;

/** Prints `node` with its comments; the rule table's rules receive `args`. */
export const p = (
  ctx: JsCtx,
  node: FormatNode | undefined,
  args?: PrintArgs,
) => (node ? ctx.print(node, args) : []);

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

export const isCall = (n: FormatNode | undefined) =>
  n !== undefined &&
  n.kind === "call_expression" &&
  field(n, "arguments")?.kind === "arguments";

/** A tagged template: tree-sitter's call_expression whose arguments are a template string. */
export const isTaggedTemplate = (n: FormatNode | undefined) =>
  n !== undefined &&
  n.kind === "call_expression" &&
  field(n, "arguments")?.kind === "template_string";

export const isMember = (n: FormatNode | undefined) =>
  n !== undefined && MEMBER_KINDS.has(n.kind);

/** A `?.`: tree-sitter-typescript leaves the one of an optional call an anonymous token. */
export const isOptionalChainToken = (c: FormatNode) =>
  c.kind === "optional_chain" || c.kind === "?.";

export const isOptional = (n: FormatNode) =>
  n.children.some(isOptionalChainToken);

/** The object of a member, the callee of a call, the tag of a tagged template. */
export const callee = (n: FormatNode) =>
  field(n, "function") ?? field(n, "constructor");

export const objectOf = (n: FormatNode) => field(n, "object");

/** The single argument of a unary-shaped node (await, spread, yield, unary), which tree-sitter puts in no field. */
export const argument = (n: FormatNode) => field(n, "argument") ?? first(n);

/** The arguments of a call or new expression, without comments. */
export function callArguments(n: FormatNode): FormatNode[] {
  const args = field(n, "arguments");
  if (args?.kind !== "arguments") return [];
  return args.children.filter((c) => c.named && !isComment(c));
}

export const isStringLiteral = (n: FormatNode | undefined) =>
  n?.kind === "string";

export const isTemplate = (n: FormatNode | undefined) =>
  n?.kind === "template_string";

export const isLiteral = (n: FormatNode | undefined) =>
  n !== undefined &&
  ["string", "number", "true", "false", "null", "undefined", "regex"].includes(
    n.kind,
  );

export const isSimpleTemplate = (ctx: JsCtx, n: FormatNode) =>
  n.kind === "template_string" &&
  n.children
    .filter((c) => c.kind === "template_substitution")
    .every((s) => {
      const e = first(s);
      return (
        e !== undefined &&
        !ctx.source.slice(s.start, s.end).includes("\n") &&
        (e.kind === "identifier" ||
          e.kind === "this" ||
          (isMember(e) && isSimpleMemberChain(e)))
      );
    });

function isSimpleMemberChain(n: FormatNode): boolean {
  for (let c: FormatNode | undefined = n; c; c = objectOf(c)) {
    if (c.kind === "identifier" || c.kind === "this") return true;
    if (c.kind !== "member_expression") return false;
    const prop = field(c, "property");
    if (prop?.kind !== "property_identifier") return false;
  }
  return false;
}

export const hasNewlineIn = (ctx: JsCtx, n: FormatNode) =>
  ctx.source.slice(n.start, n.end).includes("\n");

/** The TS type annotation child (`: T`) of a declarator, parameter or property. */
export const typeAnnotation = (n: FormatNode) =>
  n.children.find(
    (c) =>
      c.kind === "type_annotation" ||
      c.kind === "opting_type_annotation" ||
      c.kind === "omitting_type_annotation" ||
      c.kind === "adding_type_annotation",
  );

export const noArgs: Args = undefined;

/** A statement's own separator children that its rule prints (a class member's `;` sits in the body). */
export const isSemicolon = (n: FormatNode) => !n.named && n.kind === ";";

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
  n: FormatNode | undefined,
  flags = 0,
  fn?: (c: FormatNode) => boolean,
): FormatNode[] {
  if (!n) return [];
  const { leading, trailing, dangling } = ctx.comments(n);
  const total = leading.length + trailing.length + dangling.length;
  if (total === 0) return [];
  const out: FormatNode[] = [];
  let i = 0;
  const test = (c: FormatNode, kind: number) => {
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
  n: FormatNode | undefined,
  flags = 0,
  fn?: (c: FormatNode) => boolean,
) => getComments(ctx, n, flags, fn).length > 0;

export const isBlockComment = (ctx: JsCtx, c: FormatNode) =>
  !ctx.isLineComment(c);

/** Prettier's canBreak: whether `doc` holds any line. */
export function canBreak(doc: Doc): boolean {
  if (isDocs(doc)) return doc.some(canBreak);
  switch (doc.k) {
    case "line":
      return true;
    case "group":
      return (
        canBreak(doc.contents) || (doc.expandedStates?.some(canBreak) ?? false)
      );
    case "indent":
    case "align":
    case "lineSuffix":
      return canBreak(doc.contents);
    case "fill":
      return doc.parts.some(canBreak);
    case "ifBreak":
      return canBreak(doc.broken) || canBreak(doc.flat);
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
  if (doc.k === "token" || doc.k === "text") return doc.text;
  if (doc.k === "group" && !doc.expandedStates && !doc.break)
    return docText(doc.contents);
  return undefined;
}

const IGNORE = /^(?:\/\/|\/\*)\s*prettier-ignore\s*(?:\*\/)?$/;

/** Whether comment `c` is a `// prettier-ignore` or `/* prettier-ignore *\/`. */
export const isIgnoreComment = (ctx: JsCtx, c: FormatNode) =>
  IGNORE.test(src(ctx, c).trimEnd());

/** Prettier's hasLeadingOwnLineComment: a JSX element counts only an ignore comment, which it prints above itself. */
export const hasLeadingOwnLineComment = (ctx: JsCtx, n: FormatNode) =>
  isJsx(n)
    ? hasComment(ctx, n, 0, (c) => isIgnoreComment(ctx, c))
    : hasComment(ctx, n, CF.Leading, (c) => hasNewline(ctx.source, c.end));

/** Prettier's isIndentableBlockComment: a multi-line block comment whose lines all start with `*`. */
export function isIndentableBlockComment(ctx: JsCtx, c: FormatNode): boolean {
  if (ctx.isLineComment(c)) return false;
  const raw = src(ctx, c);
  if (!raw.startsWith("/*") || !raw.includes("\n")) return false;
  return `*${raw.slice(2, -2)}*`
    .split("\n")
    .every((l) => l.trimStart().startsWith("*"));
}

export const LOGICAL_OPERATORS = new Set(["&&", "||", "??"]);
export const operator = (n: FormatNode) => field(n, "operator")?.kind ?? "";
export const isBinaryish = (n: FormatNode | undefined) =>
  n?.kind === "binary_expression";
export const isLogical = (n: FormatNode | undefined) =>
  n?.kind === "binary_expression" && LOGICAL_OPERATORS.has(operator(n));
export const isAssignment = (n: FormatNode | undefined) =>
  n?.kind === "assignment_expression" ||
  n?.kind === "augmented_assignment_expression";
export const isJsx = (n: FormatNode | undefined) =>
  n?.kind === "jsx_element" || n?.kind === "jsx_self_closing_element";
export const isObjectOrRecord = (n: FormatNode | undefined) =>
  n?.kind === "object";
export const isArrayLike = (n: FormatNode | undefined) => n?.kind === "array";
export const isBoolean = (n: FormatNode | undefined) =>
  n?.kind === "true" || n?.kind === "false";

/** The named, non-comment children of `n`: its items as prettier's AST would list them. */
export const items = (n: FormatNode) =>
  n.children.filter((c) => c.named && !isComment(c));

/** The anonymous separator `sep` that follows each item of `n`, found in one pass. */
export function separators(
  n: FormatNode,
  list: readonly FormatNode[],
  sep = ",",
): Map<FormatNode, FormatNode> {
  const out = new Map<FormatNode, FormatNode>();
  const isItem = new Set(list);
  let previous: FormatNode | undefined;
  for (const c of n.children) {
    if (isItem.has(c)) previous = c;
    else if (previous && !c.named && c.kind === sep && !out.has(previous))
      out.set(previous, c);
  }
  return out;
}

/** `c` printed as the token it is, or as `as` when given (a keyword respelled, a separator dropped with ""). */
export const t = (ctx: JsCtx, c: FormatNode | undefined, as?: string): Doc =>
  c ? token(c, as ?? src(ctx, c)) : [];

/** Thrown by a printer asked to hug a call's first or last argument that cannot be hugged; the call breaks all. */
export class ArgExpansionBailout extends Error {
  override readonly name = "ArgExpansionBailout";
}

/** Prettier's FunctionExpression (generators included) or ArrowFunctionExpression. */
export const isFunctionOrArrow = (n: FormatNode | undefined) =>
  n !== undefined &&
  (n.kind === "function_expression" ||
    n.kind === "generator_function" ||
    n.kind === "arrow_function");

/** The parameters of a function, method or arrow (an arrow's lone unparenthesized one included). */
export function parameters(fn: FormatNode): FormatNode[] {
  const list = field(fn, "parameters");
  if (list) return items(list);
  const single = field(fn, "parameter");
  return single ? [single] : [];
}

/** Prettier's node type of `n` for "same type" comparisons, where a generator is a FunctionExpression. */
export const estreeType = (n: FormatNode | undefined) =>
  n?.kind === "generator_function" ? "function_expression" : n?.kind;

/** A number, or a `+`/`-` before a number with no comment between. */
export function isSignedNumber(ctx: JsCtx, n: FormatNode): boolean {
  if (n.kind === "number") return true;
  if (n.kind !== "unary_expression") return false;
  const op = operator(n);
  const arg = argument(n);
  return (
    (op === "+" || op === "-") &&
    arg?.kind === "number" &&
    !hasComment(ctx, arg)
  );
}

/** Prettier's isConciselyPrintedArray: a non-empty array of numbers, printed as a fill. */
export function isConciselyPrintedArray(ctx: JsCtx, n: FormatNode): boolean {
  if (n.kind !== "array") return false;
  const elements = items(n);
  return (
    elements.length > 0 &&
    elements.every(
      (e) =>
        isSignedNumber(ctx, e) &&
        !hasComment(
          ctx,
          e,
          CF.Trailing | CF.Line,
          (c) => !hasNewline(ctx.source, c.start, true),
        ),
    )
  );
}

/** Prettier's printDanglingComments: `n`'s dangling comments one per line, optionally indented on their own line. */
export function danglingComments(
  ctx: JsCtx,
  n: FormatNode,
  indented = false,
): Doc {
  const docs = ctx.dangling(n);
  if (docs.length === 0) return [];
  const doc = join(hardline, docs);
  return indented ? indent([hardline, doc]) : doc;
}

/** Prettier's printDanglingCommentsInList. */
export function danglingCommentsInList(ctx: JsCtx, n: FormatNode): Doc {
  const docs = ctx.dangling(n);
  if (docs.length === 0) return [];
  return [
    indent([softline, join(hardline, docs)]),
    ctx.hasDanglingLineComment(n) ? hardline : softline,
  ];
}

/** Prettier's getNextNonSpaceNonCommentCharacterIndex. */
export function nextCodeIndex(text: string, i: number): number {
  for (let old = -1; i !== old; ) {
    old = i;
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end !== -1) i = end + 2;
    } else if (text.startsWith("//", i)) {
      while (
        i < text.length &&
        text.charAt(i) !== "\n" &&
        text.charAt(i) !== "\r"
      )
        i++;
    }
  }
  return i;
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
  last: FormatNode | undefined,
  level: "es5" | "all" = "es5",
): Doc =>
  last && trailingCommaAllowed(ctx, level) ? ifBreak(synthetic(last, ",")) : [];

/** Prettier's removeLines: every soft or plain line printed flat, every group unbroken. Hard lines stay. */
export function removeLines(doc: Doc): Doc {
  if (isDocs(doc)) return doc.map(removeLines);
  switch (doc.k) {
    case "line":
      return doc.hard ? doc : doc.soft ? [] : text(" ");
    case "group":
      return doc.expandedStates
        ? removeLines(doc.expandedStates.at(-1) as Doc)
        : { ...doc, contents: removeLines(doc.contents), break: false };
    case "indent":
    case "align":
    case "lineSuffix":
      return { ...doc, contents: removeLines(doc.contents) };
    case "fill":
      return { ...doc, parts: doc.parts.map(removeLines) };
    case "ifBreak":
      return removeLines(doc.flat);
    default:
      return doc;
  }
}
