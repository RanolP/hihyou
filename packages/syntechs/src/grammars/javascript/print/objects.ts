// Prettier's object, array, property and key printers (print/object.js, array.js, property.js, key.js) and
// printMethod (print/function.js).

import {
  type Doc,
  fill,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  line,
  softline,
  synthetic,
  text,
  token,
} from "../../../fmt/doc.js";
import {
  hasNewline,
  hasNewlineInRange,
  isNextLineEmpty,
} from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { printAssignment } from "./assignment.js";
import {
  printMethodValue,
  shouldHugTheOnlyFunctionParameter,
} from "./functions.js";
import { printNumber, printString } from "./literals.js";
import { role } from "./parens.js";
import {
  CF,
  danglingComments,
  danglingCommentsInList,
  field,
  hasComment,
  isComment,
  isConciselyPrintedArray,
  items,
  type JsCtx,
  type JsRule,
  p,
  src,
  t,
  trailingCommaAllowed,
} from "./util.js";

const anonKid = (n: FormatNode, kind: string) =>
  n.children.find((c) => !c.named && c.kind === kind);

// --- keys -------------------------------------------------------------------------------------------------------

const isSimpleNumber = (s: string) => /^(?:\d+|\d+\.\d+)$/.test(s);
const ES5_IDENTIFIER =
  /^[$A-Z_a-z\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-ˁͰ-￿][$\w\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-ˁͰ-￿]*$/;
const RESERVED_NOT_KEYWORD = new Set<string>();
const isEs5IdentifierName = (s: string) =>
  ES5_IDENTIFIER.test(s) && !RESERVED_NOT_KEYWORD.has(s);

const isTypeScript = (ctx: JsCtx) => ctx.options.parser === "typescript";

/** The key child of a property-like node. */
export const keyOf = (n: FormatNode) =>
  field(n, "key") ?? field(n, "name") ?? field(n, "property");

/** A string key's value when it is plain text (no escapes), which is all prettier ever unquotes. */
function stringValue(ctx: JsCtx, key: FormatNode): string | undefined {
  if (key.kind !== "string") return undefined;
  const raw = src(ctx, key);
  const content = raw.slice(1, -1);
  return content.includes("\\") ? undefined : content;
}

function isKeySafeToUnquote(ctx: JsCtx, n: FormatNode): boolean {
  const key = keyOf(n);
  if (!key) return false;
  const value = stringValue(ctx, key);
  if (value === undefined) return false;
  if (
    printString(src(ctx, key), ctx.options.singleQuote).slice(1, -1) !== value
  )
    return false;
  if (n.kind === "method_signature" && value === "new") return false;
  const isClassProperty =
    n.kind === "public_field_definition" || n.kind === "field_definition";
  if (!(isTypeScript(ctx) && isClassProperty) && isEs5IdentifierName(value))
    return true;
  return (
    !isTypeScript(ctx) &&
    n.kind !== "import_attribute" &&
    isSimpleNumber(value) &&
    String(Number(value)) === value
  );
}

function isKeySafeToQuote(ctx: JsCtx, n: FormatNode): boolean {
  const key = keyOf(n);
  if (!key) return false;
  if (key.kind === "property_identifier" || key.kind === "identifier")
    return true;
  if (key.kind !== "number" || isTypeScript(ctx)) return false;
  const printed = printNumber(src(ctx, key));
  return String(Number(src(ctx, key))) === printed && isSimpleNumber(printed);
}

const quoteCache = new WeakMap<FormatNode, boolean>();
function hasSiblingsRequireQuoted(ctx: JsCtx, n: FormatNode): boolean {
  const parent = n.parent;
  if (!parent) return false;
  let cached = quoteCache.get(parent);
  if (cached === undefined) {
    cached = items(parent).some((sibling) => {
      const key = keyOf(sibling);
      return key?.kind === "string" && !isKeySafeToUnquote(ctx, sibling);
    });
    quoteCache.set(parent, cached);
  }
  return cached;
}

/** Prettier's printKey: a property's key, quoted or unquoted as `quoteProps` asks. */
export function printKey(ctx: JsCtx, n: FormatNode): Doc {
  const key = keyOf(n);
  if (!key) return [];
  if (key.kind === "computed_property_name") return p(ctx, key);
  const { quoteProps } = ctx.options;
  if (
    quoteProps === "consistent" &&
    hasSiblingsRequireQuoted(ctx, n) &&
    isKeySafeToQuote(ctx, n)
  ) {
    const name =
      key.kind === "number" ? String(Number(src(ctx, key))) : src(ctx, key);
    return ctx.withComments(
      key,
      token(key, printString(JSON.stringify(name), ctx.options.singleQuote)),
    );
  }
  if (
    (quoteProps === "as-needed" ||
      (quoteProps === "consistent" && !hasSiblingsRequireQuoted(ctx, n))) &&
    isKeySafeToUnquote(ctx, n)
  ) {
    const value = stringValue(ctx, key) ?? "";
    return ctx.withComments(
      key,
      token(key, /^\d/.test(value) ? printNumber(value) : value),
    );
  }
  return p(ctx, key);
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
function patternParent(n: FormatNode): FormatNode | undefined {
  let x = role(n).parent;
  while (x && PARAMETER_WRAPPERS.has(x.kind)) x = x.parent;
  return x;
}

/** Whether `n` is the one parameter of a function whose parameter prettier hugs. */
function isHuggedParameter(ctx: JsCtx, n: FormatNode): boolean {
  let x = n.parent;
  if (
    x &&
    (x.kind === "required_parameter" || x.kind === "optional_parameter")
  ) {
    // A decorated parameter is an ObjectPattern with decorators to prettier, which it never hugs.
    if (
      field(x, "pattern") !== n ||
      x.children.some((c) => c.kind === "decorator")
    )
      return false;
    x = x.parent;
  }
  return (
    x?.kind === "formal_parameters" &&
    shouldHugTheOnlyFunctionParameter(ctx, x.parent)
  );
}

/** The children between `{` and `}` with the source `,` after each. */
function members(n: FormatNode): FormatNode[] {
  return n.children.filter((c) => c.named && !isComment(c));
}

const object: JsRule = (n, ctx) => {
  const children = members(n);
  const parent = patternParent(n);
  const isPattern = n.kind === "object_pattern";
  const shouldBreak =
    n.kind === "enum_body" ||
    (isPattern &&
      !FUNCTION_PARENTS.has(parent?.kind ?? "") &&
      children.some((c) => {
        const value = c.kind === "pair_pattern" ? field(c, "value") : undefined;
        return (
          value?.kind === "object_pattern" || value?.kind === "array_pattern"
        );
      })) ||
    (!isPattern &&
      ctx.options.objectWrap === "preserve" &&
      children.length > 0 &&
      hasNewlineInRange(
        ctx.source,
        n.start,
        (children[0] as FormatNode).start,
      ));

  const open = t(ctx, anonKid(n, "{"));
  const close = t(
    ctx,
    n.children.findLast((c) => !c.named && c.kind === "}"),
  );
  let content: Doc;
  if (children.length === 0)
    content = group([open, danglingCommentsInList(ctx, n), close]);
  else {
    const parts: Doc[] = [];
    children.forEach((c, i) => {
      if (i > 0) {
        const previous = children[i - 1] as FormatNode;
        parts.push(t(ctx, commaAfter(n, previous)), line);
        if (isNextLineEmpty(ctx.source, previous.end)) parts.push(hardline);
      }
      parts.push(p(ctx, c));
    });
    const last = children.at(-1) as FormatNode;
    const spacing = ctx.options.bracketSpacing ? line : softline;
    content = [
      open,
      indent([spacing, ...parts]),
      last.kind === "rest_pattern" || !trailingCommaAllowed(ctx)
        ? []
        : ifBreak(synthetic(last, ",")),
      danglingCommentsAfter(ctx, n),
      spacing,
      close,
    ];
  }
  if (isPattern && isHuggedParameter(ctx, n)) return content;
  const { key, parent: realParent } = role(n);
  if (
    !shouldBreak &&
    isPattern &&
    ((realParent?.kind === "assignment_expression" && key === "left") ||
      (realParent?.kind === "variable_declarator" && key === "name"))
  )
    return content;
  return group(content, shouldBreak);
};

/** Dangling comments of a non-empty object sit after its last member (prettier attaches them there). */
const danglingCommentsAfter = (ctx: JsCtx, n: FormatNode): Doc => {
  const docs = danglingComments(ctx, n);
  return Array.isArray(docs) && docs.length === 0 ? [] : [line, docs];
};

function commaAfter(
  list: FormatNode,
  item: FormatNode,
): FormatNode | undefined {
  const i = list.children.indexOf(item);
  for (let j = i + 1; j < list.children.length; j++) {
    const c = list.children[j] as FormatNode;
    if (!c.named && c.kind === ",") return c;
    if (!isComment(c)) return undefined;
  }
  return undefined;
}

const pair: JsRule = (n, ctx) => {
  const colon = anonKid(n, ":");
  return printAssignment(
    ctx,
    n,
    printKey(ctx, n),
    t(ctx, colon),
    field(n, "value"),
  );
};

const assignmentPattern: JsRule = (n, ctx) => [
  p(ctx, field(n, "left")),
  text(" "),
  t(ctx, anonKid(n, "=")),
  text(" "),
  p(ctx, field(n, "right")),
];

const computedPropertyName: JsRule = (n, ctx) => [
  t(ctx, anonKid(n, "[")),
  p(ctx, items(n)[0]),
  t(ctx, anonKid(n, "]")),
];

/** Prettier's printMethod, for object and class methods alike: modifiers, key, `?`, then the method value. */
export const method: JsRule = (n, ctx) => {
  const parts: Doc[] = [];
  const name = field(n, "name");
  for (const c of n.children) {
    if (c === name) break;
    if (isComment(c)) continue;
    if (c.kind === "decorator") continue;
    parts.push(p(ctx, c));
    if (c.kind !== "*") parts.push(text(" "));
  }
  const decorators = n.children.filter((c) => c.kind === "decorator");
  return [
    printDecorators(ctx, decorators),
    parts,
    printKey(ctx, n),
    t(ctx, name && nextAnon(n, name, "?")),
    printMethodValue(ctx, n),
  ];
};

function nextAnon(
  n: FormatNode,
  after: FormatNode,
  kind: string,
): FormatNode | undefined {
  const i = n.children.indexOf(after);
  const c = n.children[i + 1];
  return c && !c.named && c.kind === kind ? c : undefined;
}

/** Prettier's printClassMemberDecorators. */
export function printDecorators(
  ctx: JsCtx,
  decorators: readonly FormatNode[],
): Doc {
  if (decorators.length === 0) return [];
  const broken = decorators.some((d) => hasNewline(ctx.source, d.end));
  return group([
    join(
      line,
      decorators.map((d) => p(ctx, d)),
    ),
    broken ? hardline : line,
  ]);
}

// --- arrays -----------------------------------------------------------------------------------------------------

/** The elements of an array, `undefined` for each hole, with the `,` after each. */
function arrayElements(
  n: FormatNode,
): { element: FormatNode | undefined; comma: FormatNode | undefined }[] {
  const out: {
    element: FormatNode | undefined;
    comma: FormatNode | undefined;
  }[] = [];
  let expecting = true;
  for (const c of n.children) {
    if (isComment(c)) continue;
    if (c.named) {
      out.push({ element: c, comma: undefined });
      expecting = false;
    } else if (c.kind === ",") {
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

const isArrayOrObject = (n: FormatNode | undefined) =>
  n !== undefined && (n.kind === "array" || n.kind === "object");

export const array: JsRule = (n, ctx) => {
  const open = t(ctx, anonKid(n, "["));
  const close = t(
    ctx,
    n.children.findLast((c) => !c.named && c.kind === "]"),
  );
  const elements = arrayElements(n);
  if (elements.length === 0)
    return group([open, danglingCommentsInList(ctx, n), close]);
  const lastElem = elements.at(-1) as (typeof elements)[number];
  const canHaveTrailingComma = lastElem.element?.kind !== "rest_pattern";
  const needsForcedTrailingComma = lastElem.element === undefined;
  const shouldBreak =
    (elements.length > 1 &&
      elements.every(({ element }, i) => {
        if (!isArrayOrObject(element)) return false;
        const next = elements[i + 1]?.element;
        if (next && next.kind !== element?.kind) return false;
        return items(element as FormatNode).length > 1;
      })) ||
    hasComment(ctx, n, CF.Dangling | CF.Line);
  const concise = isConciselyPrintedArray(ctx, n);
  const contents: Doc[] = [];
  const g = group(contents, shouldBreak);
  const lastNode = lastElem.element ?? n;
  const trailingComma: Doc = !canHaveTrailingComma
    ? []
    : needsForcedTrailingComma
      ? t(ctx, lastElem.comma)
      : !trailingCommaAllowed(ctx)
        ? []
        : concise
          ? ifBreak(synthetic(lastNode, ","), [], g)
          : ifBreak(synthetic(lastNode, ","));
  const body: Doc[] = [];
  if (concise) {
    const parts: Doc[] = [];
    elements.forEach(({ element, comma }, i) => {
      const isLast = i === elements.length - 1;
      parts.push([p(ctx, element), isLast ? trailingComma : t(ctx, comma)]);
      if (!isLast) {
        const next = elements[i + 1]?.element;
        parts.push(
          element && isNextLineEmpty(ctx.source, element.end)
            ? [hardline, hardline]
            : next && hasComment(ctx, next, CF.Leading | CF.Line)
              ? hardline
              : line,
        );
      }
    });
    body.push(fill(parts));
  } else {
    elements.forEach(({ element, comma }, i) => {
      const isLast = i === elements.length - 1;
      body.push(element ? group(p(ctx, element)) : []);
      if (!isLast)
        body.push([
          t(ctx, comma),
          line,
          element && isNextLineEmpty(ctx.source, element.end) ? softline : [],
        ]);
    });
    body.push(
      needsForcedTrailingComma ? t(ctx, lastElem.comma) : trailingComma,
    );
  }
  contents.push(
    open,
    indent([softline, body, danglingComments(ctx, n)]),
    softline,
    close,
  );
  return g;
};

const spread: JsRule = (n, ctx) => [
  t(ctx, anonKid(n, "...")),
  p(ctx, items(n)[0]),
];

export const objectRules: Record<string, JsRule> = {
  object,
  object_pattern: object,
  pair,
  pair_pattern: pair,
  object_assignment_pattern: assignmentPattern,
  computed_property_name: computedPropertyName,
  method_definition: method,
  array,
  array_pattern: array,
  spread_element: spread,
  rest_pattern: spread,
};
