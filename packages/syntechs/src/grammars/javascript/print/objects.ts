// Prettier's object, array, property and key printers (print/object.js, array.js, property.js, key.js) and
// printMethod (print/function.js).

import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import type { StreamCtx, StreamRule } from "../../../fmt/stream-format.js";
import { lfAfter, newlineBetween, nextLineEmpty } from "../../../fmt/text.js";
import { type FormatTree, firstLeaf } from "../../../fmt/tree.js";
import {
  BROKEN,
  close,
  FILL,
  FILL_ITEM,
  GROUP,
  IF_BROKEN,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  SOFT,
  sHardline,
  sLine,
  sText,
  sToken,
  withComments,
} from "../sink.js";
import { sPrintAssignment } from "./assignment.js";
import {
  sPrintMethodValue,
  shouldHugTheOnlyFunctionParameter,
} from "./functions.js";
import { printNumber, printString } from "../../../fmt/dsl/normalizers.js";
import { role } from "./parens.js";
import {
  CF,
  childWhere,
  children as childrenOf,
  field,
  type HasTree,
  hasComment,
  inModifierOrder,
  isComment,
  isConciselyPrintedArray,
  items,
  jestEach,
  type JsCtx,
  type JsOptions,
  kind,
  lastChildWhere,
  named,
  parent as parentOf,
  src,
  trailingCommaAllowed,
} from "./util.js";

const anonKid = (x: HasTree, n: number, k: string) =>
  childWhere(x, n, (c) => !named(x, c) && kind(x, c) === k);

// --- keys -------------------------------------------------------------------------------------------------------

const isSimpleNumber = (s: string) => /^(?:\d+|\d+\.\d+)$/.test(s);
const ES5_IDENTIFIER =
  /^[$A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-ˁͰ-￿][$\w\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-ˁͰ-￿]*$/;
const RESERVED_NOT_KEYWORD = new Set<string>();
const isEs5IdentifierName = (s: string) =>
  ES5_IDENTIFIER.test(s) && !RESERVED_NOT_KEYWORD.has(s);

const isTypeScript = (ctx: JsCtx) => ctx.options.parser === "typescript";

/** The key child of a property-like node. */
export const keyOf = (x: HasTree, n: number) =>
  field(x, n, "key") ?? field(x, n, "name") ?? field(x, n, "property");

/** A string key's value when it is plain text (no escapes), which is all prettier ever unquotes. */
function stringValue(ctx: JsCtx, key: number): string | undefined {
  if (kind(ctx, key) !== "string") return undefined;
  const raw = src(ctx, key);
  const content = raw.slice(1, -1);
  return content.includes("\\") ? undefined : content;
}

function isKeySafeToUnquote(ctx: JsCtx, n: number): boolean {
  const key = keyOf(ctx, n);
  if (key === undefined) return false;
  const value = stringValue(ctx, key);
  if (value === undefined) return false;
  if (
    printString(src(ctx, key), ctx.options.singleQuote).slice(1, -1) !== value
  )
    return false;
  const k = kind(ctx, n);
  if (k === "method_signature" && value === "new") return false;
  const isClassProperty =
    k === "public_field_definition" || k === "field_definition";
  if (!(isTypeScript(ctx) && isClassProperty) && isEs5IdentifierName(value))
    return true;
  return (
    !isTypeScript(ctx) &&
    k !== "import_attribute" &&
    isSimpleNumber(value) &&
    String(Number(value)) === value
  );
}

function isKeySafeToQuote(ctx: JsCtx, n: number): boolean {
  const key = keyOf(ctx, n);
  if (key === undefined) return false;
  const k = kind(ctx, key);
  if (k === "property_identifier" || k === "identifier") return true;
  if (k !== "number" || isTypeScript(ctx)) return false;
  const printed = printNumber(src(ctx, key));
  return String(Number(src(ctx, key))) === printed && isSimpleNumber(printed);
}

const quoteCache = new WeakMap<FormatTree, Map<number, boolean>>();
function hasSiblingsRequireQuoted(ctx: JsCtx, n: number): boolean {
  const parent = parentOf(ctx, n);
  if (parent === undefined) return false;
  let byParent = quoteCache.get(ctx.tree);
  if (byParent === undefined) quoteCache.set(ctx.tree, (byParent = new Map()));
  let cached = byParent.get(parent);
  if (cached === undefined) {
    cached = items(ctx, parent).some((sibling) => {
      const key = keyOf(ctx, sibling);
      return kind(ctx, key) === "string" && !isKeySafeToUnquote(ctx, sibling);
    });
    byParent.set(parent, cached);
  }
  return cached;
}

/** Prettier's printKey: a property's key, quoted or unquoted as `quoteProps` asks. */
export function sPrintKey(ctx: JsStreamCtx, n: number): void {
  const js = ctx.js;
  const key = keyOf(js, n);
  if (key === undefined) return;
  // The key's comments print here even where the key owns them (a member's head, reached through its key).
  const print = () => withComments(ctx, key, () => ctx.printNode(key));
  if (kind(js, key) === "computed_property_name") return print();
  const { quoteProps } = js.options;
  if (
    quoteProps === "consistent" &&
    hasSiblingsRequireQuoted(js, n) &&
    isKeySafeToQuote(js, n)
  ) {
    const name =
      kind(js, key) === "number" ? String(Number(src(js, key))) : src(js, key);
    return withComments(ctx, key, () =>
      sToken(key, printString(JSON.stringify(name), js.options.singleQuote)),
    );
  }
  if (
    (quoteProps === "as-needed" ||
      (quoteProps === "consistent" && !hasSiblingsRequireQuoted(js, n))) &&
    isKeySafeToUnquote(js, n)
  ) {
    const value = stringValue(js, key) ?? "";
    return withComments(ctx, key, () =>
      sToken(key, /^\d/.test(value) ? printNumber(value) : value),
    );
  }
  print();
}

// --- objects ----------------------------------------------------------------------------------------------------

const FUNCTION_PARENTS = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
  "assignment_pattern",
  "object_assignment_pattern",
  "catch_clause",
]);
const PARAMETER_WRAPPERS = new Set([
  "formal_parameters",
  "required_parameter",
  "optional_parameter",
]);

/** The node prettier's AST would give as a pattern's parent: a parameter's function, not its list. */
function patternParent(x: HasTree, n: number): number | undefined {
  let up = role(x, n).parent;
  while (up !== undefined && PARAMETER_WRAPPERS.has(kind(x, up)))
    up = parentOf(x, up);
  return up;
}

/** Whether `n` is the one parameter of a function whose parameter prettier hugs. */
function isHuggedParameter(ctx: JsCtx, n: number): boolean {
  let x = parentOf(ctx, n);
  const k = kind(ctx, x);
  if (
    x !== undefined &&
    (k === "required_parameter" || k === "optional_parameter")
  ) {
    // A decorated parameter is an ObjectPattern with decorators to prettier, which it never hugs.
    if (
      field(ctx, x, "pattern") !== n ||
      childWhere(ctx, x, (c) => kind(ctx, c) === "decorator") !== undefined
    )
      return false;
    x = parentOf(ctx, x);
  }
  return (
    kind(ctx, x) === "formal_parameters" &&
    shouldHugTheOnlyFunctionParameter(ctx, parentOf(ctx, x))
  );
}

/** The children between `{` and `}` with the source `,` after each. */
function members(x: HasTree, n: number): number[] {
  return items(x, n);
}

/** `c` as the source token it is; nothing when absent. */
const tok = (ctx: JsCtx, c: number | undefined) => {
  if (c !== undefined) sToken(c, src(ctx, c));
};

/** Prettier's printDanglingComments over the sink: `n`'s dangling comments one per line. */
function sDanglingComments(sctx: StreamCtx<JsOptions>, n: number): void {
  sctx.danglingComments(n).forEach((c, i) => {
    if (i > 0) sHardline();
    sctx.comment(c);
  });
}

/** Prettier's printDanglingCommentsInList over the sink. */
function sDanglingCommentsInList(sctx: StreamCtx<JsOptions>, n: number): void {
  const dangling = sctx.danglingComments(n);
  if (dangling.length === 0) return;
  open(INDENT);
  sLine(SOFT);
  sDanglingComments(sctx, n);
  close();
  if (dangling.some((c) => sctx.isLineComment(c))) sHardline();
  else sLine(SOFT);
}

/** Prettier's printObject, for object literals and patterns. */
const objectCustom: CustomRule<JsOptions> = (n, sctx) => {
  const { js: ctx } = jsCtx(sctx);
  const children = members(ctx, n);
  const parent = patternParent(ctx, n);
  const isPattern = kind(ctx, n) === "object_pattern";
  const shouldBreak =
    kind(ctx, n) === "enum_body" ||
    (isPattern &&
      !FUNCTION_PARENTS.has(kind(ctx, parent) ?? "") &&
      children.some((c) => {
        const value =
          kind(ctx, c) === "pair_pattern" ? field(ctx, c, "value") : undefined;
        const k = kind(ctx, value);
        return k === "object_pattern" || k === "array_pattern";
      })) ||
    (!isPattern &&
      ctx.options.objectWrap === "preserve" &&
      children.length > 0 &&
      newlineBetween(
        ctx.tree,
        firstLeaf(ctx.tree, n),
        firstLeaf(ctx.tree, children[0] as number),
      ));
  const { key, parent: realParent } = role(ctx, n);
  // A hugged parameter, and a pattern being destructured into, print their braces bare in the enclosing group.
  const grouped =
    !(isPattern && isHuggedParameter(ctx, n)) &&
    !(
      !shouldBreak &&
      isPattern &&
      ((kind(ctx, realParent) === "assignment_expression" && key === "left") ||
        (kind(ctx, realParent) === "variable_declarator" && key === "id"))
    );
  const openBrace = anonKid(ctx, n, "{");
  const closeBrace = lastChildWhere(
    ctx,
    n,
    (c) => !named(ctx, c) && kind(ctx, c) === "}",
  );
  if (grouped) open(GROUP, -1, shouldBreak ? BROKEN : 0);
  if (children.length === 0) {
    open(GROUP);
    tok(ctx, openBrace);
    sDanglingCommentsInList(sctx, n);
    tok(ctx, closeBrace);
    close();
  } else {
    const spacing = ctx.options.bracketSpacing ? 0 : SOFT;
    tok(ctx, openBrace);
    open(INDENT);
    sLine(spacing);
    children.forEach((c, i) => {
      if (i > 0) {
        const previous = children[i - 1] as number;
        tok(ctx, commaAfter(ctx, n, previous));
        sLine(0);
        if (nextLineEmpty(ctx.tree, previous)) sHardline();
      }
      sctx.print(c);
    });
    close();
    const last = children.at(-1) as number;
    if (kind(ctx, last) !== "rest_pattern" && trailingCommaAllowed(ctx)) {
      open(IF_BROKEN);
      sToken(last, ",", true);
      close();
    }
    // Dangling comments of a non-empty object sit after its last member (prettier attaches them there).
    if (sctx.danglingComments(n).length > 0) {
      sLine(0);
      sDanglingComments(sctx, n);
    }
    sLine(spacing);
    tok(ctx, closeBrace);
  }
  if (grouped) close();
};

function commaAfter(
  x: HasTree,
  list: number,
  item: number,
): number | undefined {
  const siblings = childrenOf(x, list);
  const i = siblings.indexOf(item);
  for (let j = i + 1; j < siblings.length; j++) {
    const c = siblings[j] as number;
    if (!named(x, c) && kind(x, c) === ",") return c;
    if (!isComment(x, c)) return undefined;
  }
  return undefined;
}

/** A property or a pattern's property: an assignment of its value to its key. */
const pairCustom: CustomRule<JsOptions> = (n, sctx) => {
  const s = jsCtx(sctx);
  const ctx = s.js;
  const colon = anonKid(ctx, n, ":");
  sPrintAssignment(
    s,
    n,
    () => sPrintKey(s, n),
    () => tok(ctx, colon),
    field(ctx, n, "value"),
  );
};

/** Prettier's printMethod, for object and class methods alike: modifiers, key, `?`, then the method value. */
const methodCustom: StreamRule<JsOptions> = (n, sctx) => {
  const s = jsCtx(sctx);
  const ctx = s.js;
  const name = field(ctx, n, "name");
  const kids = childrenOf(ctx, n);
  sPrintDecorators(
    sctx,
    kids.filter((c) => kind(ctx, c) === "decorator"),
  );
  const before = name !== undefined ? kids.slice(0, kids.indexOf(name)) : kids;
  for (const c of inModifierOrder(ctx, before)) {
    if (isComment(ctx, c) || kind(ctx, c) === "decorator") continue;
    sctx.print(c);
    if (kind(ctx, c) !== "*") sText(" ");
  }
  sPrintKey(s, n);
  tok(ctx, name === undefined ? undefined : nextAnon(ctx, n, name, "?"));
  sPrintMethodValue(s, n);
};

function nextAnon(
  x: HasTree,
  n: number,
  after: number,
  k: string,
): number | undefined {
  const siblings = childrenOf(x, n);
  const c = siblings[siblings.indexOf(after) + 1];
  return c !== undefined && !named(x, c) && kind(x, c) === k ? c : undefined;
}

/** Prettier's printClassMemberDecorators. */
export function sPrintDecorators(
  sctx: StreamCtx<JsOptions>,
  decorators: readonly number[],
): void {
  if (decorators.length === 0) return;
  open(GROUP);
  decorators.forEach((d, i) => {
    if (i > 0) sLine(0);
    sctx.print(d);
  });
  if (decorators.some((d) => lfAfter(sctx.tree, d) > 0)) sHardline();
  else sLine(0);
  close();
}

// --- arrays -----------------------------------------------------------------------------------------------------

/** The elements of an array, `undefined` for each hole, with the `,` after each. */
function arrayElements(
  x: HasTree,
  n: number,
): { element: number | undefined; comma: number | undefined }[] {
  const out: {
    element: number | undefined;
    comma: number | undefined;
  }[] = [];
  let expecting = true;
  for (const c of childrenOf(x, n)) {
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

const isArrayOrObject = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "array" || kind(x, n) === "object";

/** Prettier's printArray, for arrays and array patterns (and, through `array`, tuple types). */
const arrayCustom: StreamRule<JsOptions> = (n, sctx) => {
  const { js: ctx } = jsCtx(sctx);
  const openBracket = anonKid(ctx, n, "[");
  const closeBracket = lastChildWhere(
    ctx,
    n,
    (c) => !named(ctx, c) && kind(ctx, c) === "]",
  );
  const elements = arrayElements(ctx, n);
  if (elements.length === 0) {
    open(GROUP);
    tok(ctx, openBracket);
    sDanglingCommentsInList(sctx, n);
    tok(ctx, closeBracket);
    close();
    return;
  }
  const lastElem = elements.at(-1) as (typeof elements)[number];
  const canHaveTrailingComma = kind(ctx, lastElem.element) !== "rest_pattern";
  const needsForcedTrailingComma = lastElem.element === undefined;
  const shouldBreak =
    (!jestEach.printing &&
      elements.length > 1 &&
      elements.every(({ element }, i) => {
        if (!isArrayOrObject(ctx, element)) return false;
        const next = elements[i + 1]?.element;
        if (next !== undefined && kind(ctx, next) !== kind(ctx, element))
          return false;
        return items(ctx, element as number).length > 1;
      })) ||
    hasComment(ctx, n, CF.Dangling | CF.Line);
  const concise = isConciselyPrintedArray(ctx, n);
  const g = open(GROUP, -1, shouldBreak ? BROKEN : 0);
  const lastNode = lastElem.element ?? n;
  const trailingComma = () => {
    if (!canHaveTrailingComma) return;
    if (needsForcedTrailingComma) tok(ctx, lastElem.comma);
    else if (trailingCommaAllowed(ctx)) {
      // In the fill the comma follows the array's group, not the fill item it sits in.
      open(IF_BROKEN, concise ? g : -1);
      sToken(lastNode, ",", true);
      close();
    }
  };
  // Unlike objects and argument lists, prettier's array measures the blank line after an element's comma.
  const blankAfter = (comma: number | undefined) =>
    comma !== undefined && nextLineEmpty(ctx.tree, comma);
  tok(ctx, openBracket);
  open(INDENT);
  sLine(SOFT);
  if (concise) {
    open(FILL);
    elements.forEach(({ element, comma }, i) => {
      const isLast = i === elements.length - 1;
      open(FILL_ITEM);
      if (element !== undefined) sctx.print(element);
      if (isLast) trailingComma();
      else tok(ctx, comma);
      close();
      if (!isLast) {
        const next = elements[i + 1]?.element;
        if (element !== undefined && blankAfter(comma)) {
          sHardline();
          sHardline();
        } else if (
          next !== undefined &&
          hasComment(ctx, next, CF.Leading | CF.Line)
        )
          sHardline();
        else sLine(0);
      }
    });
    close();
  } else {
    elements.forEach(({ element, comma }, i) => {
      if (element !== undefined) {
        open(GROUP);
        sctx.print(element);
        close();
      }
      if (i < elements.length - 1) {
        tok(ctx, comma);
        sLine(0);
        if (element !== undefined && blankAfter(comma)) sLine(SOFT);
      }
    });
    trailingComma();
  }
  sDanglingComments(sctx, n);
  close();
  sLine(SOFT);
  tok(ctx, closeBracket);
  close();
};

export const objectCustoms = {
  object: objectCustom,
  array: arrayCustom,
  pair: pairCustom,
  method: methodCustom,
} satisfies Record<string, CustomRule<JsOptions>>;
