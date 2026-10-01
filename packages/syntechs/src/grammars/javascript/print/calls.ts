// Prettier's call and member printers: call-expression.js, member.js, member-chain.js, call-arguments.js, and
// the utilities they lean on (is-simple-call-argument.js, test-libraries.js, is-long-curried-call-expression.js,
// is-function-composition-arguments.js, is-template-on-its-own-line.js).

import { NO_NODE } from "../../../core/arena.js";
import { newlineBetween, nextLineEmpty } from "../../../fmt/text.js";
import { firstLeaf, nextLeaf, prevLeaf } from "../../../fmt/tree.js";
import { textWidth } from "../../../fmt/width.js";
import { awaitsHere, needsParens, role } from "./parens.js";
import {
  ArgExpansionBailout,
  argument,
  CF,
  callArguments,
  callee,
  children,
  childWhere,
  estreeType,
  field,
  first,
  type HasTree,
  hasComment,
  isCall,
  isConciselyPrintedArray,
  isFunctionOrArrow,
  isJsx,
  isMember,
  isOptionalChainToken,
  isSimpleType,
  isTaggedTemplate,
  items,
  type JsCtx,
  kind,
  parent,
  lastChildWhere,
  objectOf,
  operator,
  parameters,
  separators,
  src,
  trailingCommaAllowed,
  unassert,
  unparen,
} from "./util.js";
import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import {
  BROKEN,
  capture,
  close,
  closeChoice,
  closeState,
  GROUP,
  IF_BROKEN,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  openChoice,
  openState,
  type Part,
  place,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sLineSuffixBoundary,
  sText,
  sToken,
  willBreak,
  withComments,
} from "../sink.js";
import type { JsOptions } from "./util.js";

// Prettier labels a member chain's doc so that an assignment and a member lookup can see it; here the label is
// kept per printed node.
const memberChains = new WeakMap<JsCtx, Set<number>>();
function markMemberChain(ctx: JsCtx, n: number) {
  let set = memberChains.get(ctx);
  if (!set) {
    set = new Set();
    memberChains.set(ctx, set);
  }
  set.add(n);
}

/** Whether `n` prints as a member chain (prettier's `label.memberChain` on its doc). */
export function printsAsMemberChain(sctx: JsStreamCtx, n: number): boolean {
  const ctx = sctx.js;
  const inner = unparen(ctx, n);
  capture(() => sctx.print(inner));
  return memberChains.get(ctx)?.has(inner) ?? false;
}

/** A call proper: not a tagged template, not `import(...)`. */
const isCallExpression = (x: HasTree, n: number | undefined) =>
  isCall(x, n) && kind(x, callee(x, n as number)) !== "import";

const isDynamicImport = (x: HasTree, n: number) =>
  kind(x, n) === "call_expression" && kind(x, callee(x, n)) === "import";

const isCallLike = (x: HasTree, n: number) =>
  isCall(x, n) || kind(x, n) === "new_expression";

/** The arguments list node of a call (its comments are printed with the arguments). */
const argumentsNode = (x: HasTree, n: number) => {
  const a = field(x, n, "arguments");
  return kind(x, a) === "arguments" ? a : undefined;
};

// --- utilities ----------------------------------------------------------------------------------------------

/** The dotted name of a callee made of identifiers (`describe.only`), else undefined. */
function dottedName(ctx: JsCtx, n: number | undefined): string | undefined {
  if (n === undefined) return undefined;
  const k = kind(ctx, n);
  if (k === "identifier") return src(ctx, n);
  if (k === "meta_property") return src(ctx, n).replaceAll(/\s/g, "");
  if (k === "member_expression" && !isOptionalCall(ctx, n)) {
    const object = dottedName(ctx, objectOf(ctx, n));
    const property = field(ctx, n, "property");
    if (
      object === undefined ||
      property === undefined ||
      kind(ctx, property) !== "property_identifier"
    )
      return undefined;
    return `${object}.${src(ctx, property)}`;
  }
  return undefined;
}

const TEST_CALLEES = new Set([
  "it",
  "it.only",
  "it.skip",
  "describe",
  "describe.only",
  "describe.skip",
  "test",
  "test.only",
  "test.skip",
  "test.fixme",
  "test.step",
  "test.describe",
  "test.describe.only",
  "test.describe.skip",
  "test.describe.fixme",
  "test.describe.parallel",
  "test.describe.parallel.only",
  "test.describe.serial",
  "test.describe.serial.only",
  "skip",
  "xit",
  "xdescribe",
  "xtest",
  "fit",
  "fdescribe",
  "ftest",
]);

const isOptionalCall = (x: HasTree, n: number) =>
  childWhere(x, n, (c) => isOptionalChainToken(x, c)) !== undefined;

function isAngularTestWrapper(ctx: JsCtx, n: number | undefined): boolean {
  if (n === undefined || !isCallExpression(ctx, n)) return false;
  const c = callee(ctx, n);
  return (
    c !== undefined &&
    kind(ctx, c) === "identifier" &&
    ["async", "inject", "fakeAsync", "waitForAsync"].includes(src(ctx, c))
  );
}

const hasBlockBody = (x: HasTree, n: number) => {
  const k = kind(x, n);
  return (
    k === "function_expression" ||
    k === "generator_function" ||
    (k === "arrow_function" &&
      kind(x, field(x, n, "body")) === "statement_block")
  );
};

/** Prettier's isTestCall. */
export function isTestCall(
  ctx: JsCtx,
  n: number | undefined,
  parent?: number,
): boolean {
  if (n === undefined || !isCallExpression(ctx, n) || isOptionalCall(ctx, n))
    return false;
  const args = callArguments(ctx, n).map((a) => unparen(ctx, a));
  const c = callee(ctx, n);
  if (args.length === 1) {
    if (isAngularTestWrapper(ctx, n) && isTestCall(ctx, parent))
      return isFunctionOrArrow(ctx, args[0]);
    if (
      c !== undefined &&
      kind(ctx, c) === "identifier" &&
      ["beforeEach", "beforeAll", "afterEach", "afterAll"].includes(src(ctx, c))
    )
      return isAngularTestWrapper(ctx, args[0]);
  } else if (
    (args.length === 2 || args.length === 3) &&
    (kind(ctx, args[0]) === "template_string" ||
      kind(ctx, args[0]) === "string") &&
    TEST_CALLEES.has(dottedName(ctx, c) ?? "")
  ) {
    const [, second, third] = args;
    if (third !== undefined && kind(ctx, third) !== "number") return false;
    if (second === undefined) return false;
    return (
      (args.length === 2
        ? isFunctionOrArrow(ctx, second)
        : hasBlockBody(ctx, second) && parameters(ctx, second).length <= 1) ||
      isAngularTestWrapper(ctx, second)
    );
  }
  return false;
}

const SIMPLE_UNARY = new Set(["!", "-", "+", "~"]);
const SINGLE_WORD = new Set([
  "identifier",
  "this",
  "super",
  "private_property_identifier",
  "undefined",
  "property_identifier",
  "shorthand_property_identifier",
]);
const LITERALS = new Set(["string", "number", "true", "false", "null"]);

/** Prettier's isSimpleCallArgument. */
export function isSimpleCallArgument(
  ctx: JsCtx,
  node: number,
  depth = 2,
): boolean {
  if (depth <= 0) return false;
  const n = unparen(ctx, node);
  const k = kind(ctx, n);
  const child = (c: number) => isSimpleCallArgument(ctx, c, depth - 1);
  if (k === "regex") {
    const pattern = field(ctx, n, "pattern");
    return pattern !== undefined ? textWidth(src(ctx, pattern)) <= 5 : true;
  }
  if (LITERALS.has(k) || SINGLE_WORD.has(k)) return true;
  if (k === "template_string")
    return children(ctx, n).every((c) =>
      kind(ctx, c) === "template_substitution"
        ? (() => {
            const e = first(ctx, c);
            return e !== undefined && child(e);
          })()
        : kind(ctx, c) === "comment" || !src(ctx, c).includes("\n"),
    );
  if (k === "object")
    return items(ctx, n).every((prop) => {
      if (kind(ctx, prop) === "shorthand_property_identifier") return true;
      if (kind(ctx, prop) !== "pair") return false;
      const key = field(ctx, prop, "key");
      const value = field(ctx, prop, "value");
      return (
        kind(ctx, key) !== "computed_property_name" &&
        value !== undefined &&
        child(value)
      );
    });
  if (k === "array") return items(ctx, n).every(child);
  if (isDynamicImport(ctx, n)) {
    const args = callArguments(ctx, n);
    return args.length <= depth && args.every(child);
  }
  if (isCallLike(ctx, n)) {
    const c = callee(ctx, n);
    if (c !== undefined && isSimpleCallArgument(ctx, c, depth)) {
      const args = callArguments(ctx, n);
      return args.length <= depth && args.every(child);
    }
    return false;
  }
  if (isMember(ctx, n)) {
    const object = objectOf(ctx, n);
    const property = field(ctx, n, "property") ?? field(ctx, n, "index");
    return (
      object !== undefined &&
      property !== undefined &&
      isSimpleCallArgument(ctx, object, depth) &&
      isSimpleCallArgument(ctx, property, depth)
    );
  }
  if (k === "non_null_expression") {
    const e = first(ctx, n);
    return e !== undefined && isSimpleCallArgument(ctx, e, depth);
  }
  if (
    (k === "unary_expression" && SIMPLE_UNARY.has(operator(ctx, n))) ||
    k === "update_expression"
  ) {
    const a = argument(ctx, n);
    return a !== undefined && isSimpleCallArgument(ctx, a, depth);
  }
  return false;
}

/** Prettier's isLongCurriedCallExpression: `a(1)(2, 3)` seen from `a(1)`. */
function isLongCurriedCall(x: HasTree, n: number): boolean {
  const { parent, key } = role(x, n);
  return (
    key === "callee" &&
    isCallExpression(x, n) &&
    parent !== undefined &&
    isCallExpression(x, parent) &&
    callArguments(x, parent).length > 0 &&
    callArguments(x, n).length > callArguments(x, parent).length
  );
}

function isFunctionCompositionArguments(
  x: HasTree,
  args: readonly number[],
): boolean {
  if (args.length <= 1) return false;
  let count = 0;
  for (const raw of args) {
    const arg = unassert(x, raw);
    if (isFunctionOrArrow(x, arg)) {
      count += 1;
      if (count > 1) return true;
    } else if (isCallExpression(x, arg)) {
      if (
        callArguments(x, arg).some((a) => isFunctionOrArrow(x, unparen(x, a)))
      )
        return true;
    }
  }
  return false;
}

const templateHasNewLines = (ctx: JsCtx, n: number) =>
  childWhere(ctx, n, (c) => {
    const k = kind(ctx, c);
    return (
      k !== "template_substitution" &&
      k !== "comment" &&
      src(ctx, c).includes("\n")
    );
  }) !== undefined;

/** Prettier's isTemplateOnItsOwnLine. */
export function isTemplateOnItsOwnLine(ctx: JsCtx, n: number): boolean {
  const template =
    kind(ctx, n) === "template_string"
      ? n
      : isTaggedTemplate(ctx, n)
        ? field(ctx, n, "arguments")
        : undefined;
  return (
    template !== undefined &&
    templateHasNewLines(ctx, template) &&
    ctx.tree.lf(n) === 0
  );
}

const CAST_KINDS = new Set([
  "as_expression",
  "satisfies_expression",
  "type_assertion",
]);

/** The expression of `x as T`, `x satisfies T`, `<T>x`. */
const castExpression = (x: HasTree, n: number) =>
  kind(x, n) === "type_assertion" ? items(x, n).at(-1) : first(x, n);

/** Prettier's couldExpandArg. */
export function couldExpandArg(
  ctx: JsCtx,
  raw: number,
  arrowChainRecursion = false,
): boolean {
  const arg = unparen(ctx, raw);
  const k = kind(ctx, arg);
  if (k === "object" && (items(ctx, arg).length > 0 || hasComment(ctx, arg)))
    return true;
  if (k === "array" && (items(ctx, arg).length > 0 || hasComment(ctx, arg)))
    return true;
  if (CAST_KINDS.has(k)) {
    const e = castExpression(ctx, arg);
    return e !== undefined && couldExpandArg(ctx, e);
  }
  if (k === "function_expression" || k === "generator_function") return true;
  if (k === "arrow_function") {
    const bodyNode = field(ctx, arg, "body");
    if (bodyNode === undefined) return false;
    const body = unparen(ctx, bodyNode);
    const bk = kind(ctx, body);
    if (
      bk === "statement_block" ||
      isJsx(ctx, body) ||
      bk === "object" ||
      bk === "array"
    )
      return true;
    if (bk === "arrow_function" && couldExpandArg(ctx, body, true)) return true;
    if (!arrowChainRecursion) {
      if (bk === "ternary_expression") return true;
      if (isCallExpression(ctx, unassert(ctx, body))) return true;
    }
  }
  return false;
}

function isHopefullyShortCallArgument(ctx: JsCtx, raw: number): boolean {
  const n = unparen(ctx, raw);
  const k = kind(ctx, n);
  if (k === "as_expression" || k === "satisfies_expression") {
    let type = items(ctx, n).at(-1);
    if (type !== undefined && kind(ctx, type) === "array_type") {
      type = first(ctx, type);
      if (type !== undefined && kind(ctx, type) === "array_type")
        type = first(ctx, type);
    }
    if (type !== undefined && kind(ctx, type) === "generic_type") {
      const ta = field(ctx, type, "type_arguments");
      const params = ta !== undefined ? items(ctx, ta) : [];
      if (params.length === 1) type = params[0];
    }
    const e = first(ctx, n);
    return (
      isSimpleType(ctx, type) &&
      e !== undefined &&
      isSimpleCallArgument(ctx, e, 1)
    );
  }
  if (isCallLike(ctx, n) && callArguments(ctx, n).length > 1) return false;
  if (k === "binary_expression") {
    const left = field(ctx, n, "left");
    const right = field(ctx, n, "right");
    return (
      left !== undefined &&
      right !== undefined &&
      isSimpleCallArgument(ctx, left, 1) &&
      isSimpleCallArgument(ctx, right, 1)
    );
  }
  return k === "regex" || isSimpleCallArgument(ctx, n);
}

function shouldExpandFirstArg(ctx: JsCtx, args: readonly number[]): boolean {
  if (args.length !== 2) return false;
  const [firstRaw, secondRaw] = args as [number, number];
  const firstArg = unparen(ctx, firstRaw);
  const second = unparen(ctx, secondRaw);
  return (
    !hasComment(ctx, firstRaw) &&
    !hasComment(ctx, firstArg) &&
    hasBlockBody(ctx, firstArg) &&
    !isFunctionOrArrow(ctx, second) &&
    kind(ctx, second) !== "ternary_expression" &&
    isHopefullyShortCallArgument(ctx, second) &&
    !couldExpandArg(ctx, second)
  );
}

function shouldExpandLastArg(ctx: JsCtx, args: readonly number[]): boolean {
  const lastRaw = args.at(-1);
  if (lastRaw === undefined) return false;
  const last = unparen(ctx, lastRaw);
  const penultimateRaw = args.at(-2);
  const penultimate =
    penultimateRaw !== undefined ? unparen(ctx, penultimateRaw) : undefined;
  return (
    !hasComment(ctx, lastRaw, CF.Leading) &&
    !hasComment(ctx, lastRaw, CF.Trailing) &&
    !hasComment(ctx, last, CF.Leading) &&
    !hasComment(ctx, last, CF.Trailing) &&
    couldExpandArg(ctx, last) &&
    (penultimate === undefined ||
      estreeType(ctx, penultimate) !== estreeType(ctx, last)) &&
    (args.length !== 2 ||
      kind(ctx, penultimate) !== "arrow_function" ||
      kind(ctx, last) !== "array") &&
    !(args.length > 1 && isConciselyPrintedArray(ctx, last))
  );
}

/** `f((⏎// c⏎) => {})`: oxfmt hugs no last function whose empty parameter list holds a line comment. */
function oxfmtBreaksEmptyParams(sctx: JsStreamCtx, raw: number): boolean {
  const ctx = sctx.js;
  const list = field(ctx, unparen(ctx, raw), "parameters");
  return (
    list !== undefined &&
    items(ctx, list).length === 0 &&
    sctx.danglingComments(list).some((c) => sctx.isLineComment(c))
  );
}

function isReactHookCallWithDepsArray(
  ctx: JsCtx,
  raw: readonly number[],
): boolean {
  const args = raw.map((a) => unparen(ctx, a));
  const valid = (base: number) => {
    const fn = args[base];
    const deps = args[base + 1];
    return (
      fn !== undefined &&
      kind(ctx, fn) === "arrow_function" &&
      parameters(ctx, fn).length === 0 &&
      kind(ctx, field(ctx, fn, "body")) === "statement_block" &&
      kind(ctx, deps) === "array" &&
      raw.every((a) => !hasComment(ctx, a))
    );
  };
  if (args.length === 2) return valid(0);
  if (args.length === 3) return kind(ctx, args[0]) === "identifier" && valid(1);

  return false;
}

// --- call arguments -----------------------------------------------------------------------------------------

/** `n`'s `?.`, into the sink. */
const sOptional = (ctx: JsCtx, n: number) =>
  sTok(
    ctx,
    childWhere(ctx, n, (c) => isOptionalChainToken(ctx, c)),
  );

/** `n`'s type arguments, into the sink. */
const sTypeArguments = (sctx: JsStreamCtx, n: number) => {
  const ta = field(sctx.js, n, "type_arguments");
  if (ta === undefined) return;
  sctx.print(ta);
  // oxfmt carries a comment in or after them to the end of the line.
};

/** Prettier's printDanglingCommentsInList over the sink. */
function sDanglingCommentsInList(sctx: JsStreamCtx, n: number): void {
  const dangling = sctx.danglingComments(n);
  if (dangling.length === 0) return;
  open(INDENT);
  sLine(SOFT);
  dangling.forEach((c, i) => {
    if (i > 0) sHardline();
    sctx.comment(c);
  });
  close();
  if (dangling.some((c) => sctx.isLineComment(c))) sHardline();
  else sLine(SOFT);
}

/** Prettier's printCallArguments over the call (or new expression) `n`. */
function sCallArguments(sctx: JsStreamCtx, n: number): void {
  const ctx = sctx.js;
  const list = argumentsNode(ctx, n);
  if (list === undefined) {
    // `new A` prints as `new A()`.
    if (kind(ctx, n) === "new_expression") {
      sToken(n, "(", true);
      sToken(n, ")", true);
    }
    return;
  }
  withComments(sctx, list, () => sArguments(sctx, n, list));
}

/** `(x)` in a script's `await (x)`, which oxc reads as the argument list of a call of `await`. */
export const sAwaitCallArguments = (sctx: JsStreamCtx, paren: number): void =>
  sArguments(sctx, paren, paren);

/** Writes each of `states` as one state of a conditional group. */
function sConditionalGroup(states: readonly (() => void)[]): void {
  openChoice(false);
  for (const state of states) {
    openState();
    state();
    closeState();
  }
  closeChoice();
}

function sArguments(sctx: JsStreamCtx, n: number, list: number): void {
  const ctx = sctx.js;
  const openParen = childWhere(ctx, list, (c) => kind(ctx, c) === "(");
  const closeParen = lastChildWhere(ctx, list, (c) => kind(ctx, c) === ")");
  const args = items(ctx, list);
  if (args.length === 0) {
    open(GROUP);
    sTok(ctx, openParen);
    sDanglingCommentsInList(sctx, list);
    sTok(ctx, closeParen);
    close();
    return;
  }
  const commas = separators(ctx, list, args);
  const comma = (a: number) => sTok(ctx, commas.get(a));
  const lastIndex = args.length - 1;

  if (isReactHookCallWithDepsArray(ctx, args)) {
    sTok(ctx, openParen);
    args.forEach((a, i) => {
      sctx.print(a);
      if (i === lastIndex) return;
      comma(a);
      sText(" ");
    });
    sTok(ctx, closeParen);
    return;
  }

  let anyArgEmptyLine = false;
  const printedArguments = args.map((a, i) =>
    capture(() => {
      sctx.print(a);
      if (i === lastIndex) return;
      comma(a);
      if (nextLineEmpty(ctx.tree, a)) {
        anyArgEmptyLine = true;
        sHardline();
        sHardline();
      } else sLine(0);
    }),
  );
  const last = args[lastIndex] as number;
  const trailing =
    !isDynamicImport(ctx, n) && trailingCommaAllowed(ctx, "all");
  const sTrailing = () => {
    if (!trailing) return;
    open(IF_BROKEN);
    sToken(last, ",", true);
    close();
  };

  const allArgsBrokenOut = () => {
    open(GROUP, -1, BROKEN);
    sTok(ctx, openParen);
    open(INDENT);
    sLine(0);
    printedArguments.forEach(place);
    close();
    sTrailing();
    sLine(0);
    sTok(ctx, closeParen);
    close();
  };
  const brokenGroup = (part: Part) => {
    open(GROUP, -1, BROKEN);
    place(part);
    close();
  };

  if (
    anyArgEmptyLine ||
    (kind(ctx, role(ctx, n).parent) !== "decorator" &&
      isFunctionCompositionArguments(ctx, args))
  )
    return allArgsBrokenOut();

  if (shouldExpandFirstArg(ctx, args)) {
    const tail = printedArguments.slice(1);
    if (tail.some(willBreak)) return allArgsBrokenOut();
    const firstArg = args[0] as number;
    let firstDoc: Part;
    try {
      firstDoc = capture(() => sctx.print(firstArg, { expandFirstArg: true }));
    } catch (caught) {
      if (caught instanceof ArgExpansionBailout) return allArgsBrokenOut();
      throw caught;
    }
    const hugged = (hug: (part: Part) => void) => () => {
      sTok(ctx, openParen);
      hug(firstDoc);
      comma(firstArg);
      sText(" ");
      tail.forEach(place);
      sTok(ctx, closeParen);
    };
    if (willBreak(firstDoc)) {
      sBreakParent();
      return sConditionalGroup([hugged(brokenGroup), allArgsBrokenOut]);
    }
    return sConditionalGroup([
      hugged(place),
      hugged(brokenGroup),
      allArgsBrokenOut,
    ]);
  }

  if (shouldExpandLastArg(ctx, args)) {
    const head = printedArguments.slice(0, -1);
    if (head.some(willBreak) || oxfmtBreaksEmptyParams(sctx, args.at(-1) as number))
      return allArgsBrokenOut();
    let lastDoc: Part;
    try {
      lastDoc = capture(() => sctx.print(last, { expandLastArg: true }));
    } catch (caught) {
      if (caught instanceof ArgExpansionBailout) return allArgsBrokenOut();
      throw caught;
    }
    const hugged = (hug: (part: Part) => void) => () => {
      sTok(ctx, openParen);
      head.forEach(place);
      hug(lastDoc);
      sTok(ctx, closeParen);
    };
    if (willBreak(lastDoc)) {
      sBreakParent();
      return sConditionalGroup([hugged(brokenGroup), allArgsBrokenOut]);
    }
    return sConditionalGroup([
      hugged(place),
      hugged(brokenGroup),
      allArgsBrokenOut,
    ]);
  }

  const grouped = !isLongCurriedCall(ctx, n);
  if (grouped)
    open(GROUP, -1, printedArguments.some(willBreak) ? BROKEN : 0);
  sTok(ctx, openParen);
  open(INDENT);
  sLine(SOFT);
  printedArguments.forEach(place);
  close();
  sTrailing();
  sLine(SOFT);
  sTok(ctx, closeParen);
  if (grouped) close();
}

// --- member expressions -------------------------------------------------------------------------------------

/** Up through members (as their object) and non-null assertions, whether `n` is the callee of a `new`. */
function isNewCallee(x: HasTree, n: number): boolean {
  let child = n;
  for (;;) {
    const { parent, key } = role(x, child);
    if (parent === undefined) return false;
    if (
      (isMember(x, parent) && key === "object") ||
      kind(x, parent) === "non_null_expression"
    ) {
      child = parent;
      continue;
    }
    return kind(x, parent) === "new_expression" && key === "callee";
  }
}

// A member chain in a type (`import("x").A.B`, `typeof a.b`) is prettier's TSImportType qualifier or
// TSQualifiedName, which it joins with bare dots and never breaks.
const isInType = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return (
    k === "type_annotation" ||
    k === "type_query" ||
    k === "generic_type" ||
    k === "type_arguments" ||
    (k?.endsWith("_type") ?? false)
  );
};

/** `c` as the source token it is, into the sink; nothing when absent. */
const sTok = (ctx: JsCtx, c: number | undefined) => {
  if (c !== undefined) sToken(c, src(ctx, c));
};

/** printMemberLookup into the sink. */
function sMemberLookup(sctx: JsStreamCtx, n: number): void {
  const ctx = sctx.js;
  const optional = childWhere(ctx, n, (c) => isOptionalChainToken(ctx, c));
  if (kind(ctx, n) === "member_expression") {
    sTok(ctx, optional);
    sTok(
      ctx,
      childWhere(ctx, n, (c) => kind(ctx, c) === "."),
    );
    const property = field(ctx, n, "property");
    if (property !== undefined) sctx.print(property);
    return;
  }
  const index = field(ctx, n, "index");
  const openBracket = childWhere(ctx, n, (c) => kind(ctx, c) === "[");
  const closeBracket = lastChildWhere(ctx, n, (c) => kind(ctx, c) === "]");
  if (index === undefined || kind(ctx, unparen(ctx, index)) === "number") {
    sTok(ctx, optional);
    sTok(ctx, openBracket);
    if (index !== undefined) sctx.print(index);
    sTok(ctx, closeBracket);
    return;
  }
  open(GROUP);
  sTok(ctx, optional);
  sTok(ctx, openBracket);
  open(INDENT);
  sLine(SOFT);
  sctx.print(index);
  close();
  sLine(SOFT);
  sTok(ctx, closeBracket);
  close();
}

/** Prettier's printMemberExpression, for `a.b` and `a[b]`. */
const memberCustom: CustomRule<JsOptions> = (n, s) => {
  const sctx = jsCtx(s);
  const ctx = sctx.js;
  const object = objectOf(ctx, n);
  if (object !== undefined) sctx.print(object);
  let firstNonMember = role(ctx, n);
  while (
    firstNonMember.parent !== undefined &&
    (isMember(ctx, firstNonMember.parent) ||
      kind(ctx, firstNonMember.parent) === "non_null_expression")
  )
    firstNonMember = role(ctx, firstNonMember.parent);
  const parent = role(ctx, n).parent;
  const property = field(ctx, n, "property");
  const inner = object !== undefined ? unparen(ctx, object) : undefined;
  // `f(x)!.y` and `f(x).y!` hug like `f(x).y`: the assertions are looked through on both sides.
  const asserted = object !== undefined ? unassert(ctx, object) : undefined;
  let owner = parent;
  while (kind(ctx, owner) === "non_null_expression")
    owner = role(ctx, owner as number).parent;
  const fnp = firstNonMember.parent;
  const shouldInline =
    (kind(ctx, fnp) === "assignment_expression" ||
    kind(ctx, fnp) === "augmented_assignment_expression"
      ? kind(ctx, unparen(ctx, field(ctx, fnp as number, "left") as number)) !==
        "identifier"
      : false) ||
    isNewCallee(ctx, n) ||
    isInType(ctx, fnp) ||
    kind(ctx, n) === "subscript_expression" ||
    (kind(ctx, inner) === "identifier" &&
      kind(ctx, property) === "property_identifier" &&
      !isMember(ctx, parent)) ||
    ((kind(ctx, owner) === "assignment_expression" ||
      kind(ctx, owner) === "variable_declarator") &&
      asserted !== undefined &&
      ((isCallExpression(ctx, asserted) &&
        callArguments(ctx, asserted).length > 0) ||
        (memberChains.get(ctx)?.has(asserted) ?? false)));
  if (inner !== undefined && memberChains.get(ctx)?.has(inner))
    markMemberChain(ctx, n);
  if (shouldInline) sMemberLookup(sctx, n);
  else {
    open(GROUP);
    open(INDENT);
    sLine(SOFT);
    sMemberLookup(sctx, n);
    close();
    close();
  }
};

// --- member chains ------------------------------------------------------------------------------------------

interface Printed {
  node: number;
  printed: Part;
  hasTrailingEmptyLine?: boolean;
}

const isFactory = (name: string) => /^[A-Z]|^[$_]+$/.test(name);

/** Prettier's printMemberChain for call `n` whose callee is a member. */
function sMemberChain(sctx: JsStreamCtx, n: number): void {
  const ctx = sctx.js;
  const top = role(ctx, n);
  const isExpressionStatement =
    kind(ctx, top.parent) === "expression_statement";
  const printedNodes: Printed[] = [];

  const shouldInsertEmptyLineAfter = (node: number) => {
    // Prettier looks past the spaces and comments after `node` for a `)`, and then after that `)`.
    let next = nextLeaf(ctx.tree, node);
    while (
      next !== NO_NODE &&
      (kind(ctx, next) === "comment" || src(ctx, next) === "")
    )
      next = nextLeaf(ctx.tree, next);
    if (next !== NO_NODE && src(ctx, next) === ")")
      return nextLineEmpty(ctx.tree, next);
    return nextLineEmpty(ctx.tree, node);
  };

  const rec = (node: number) => {
    if (kind(ctx, node) === "parenthesized_expression") {
      const inner = unparen(ctx, node);
      const kept =
        inner === node ||
        hasComment(ctx, node) ||
        needsParens(inner, ctx);
      if (!kept) return rec(inner);
      printedNodes.unshift({ node, printed: capture(() => sctx.print(node)) });
      return;
    }
    if (
      isCallExpression(ctx, node) &&
      (isMember(ctx, unparen(ctx, callee(ctx, node) as number)) ||
        isCallExpression(ctx, unparen(ctx, callee(ctx, node) as number))) &&
      !needsParens(node, ctx)
    ) {
      const hasTrailingEmptyLine = shouldInsertEmptyLineAfter(node);
      printedNodes.unshift({
        node,
        hasTrailingEmptyLine,
        printed: capture(() => {
          withComments(sctx, node, () => {
            sOptional(ctx, node);
            sTypeArguments(sctx, node);
            sCallArguments(sctx, node);
          });
          if (hasTrailingEmptyLine) sHardline();
        }),
      });
      rec(callee(ctx, node) as number);
    } else if (isMember(ctx, node) && !needsParens(node, ctx)) {
      printedNodes.unshift({
        node,
        printed: capture(() =>
          withComments(sctx, node, () => sMemberLookup(sctx, node)),
        ),
      });
      rec(objectOf(ctx, node) as number);
    } else if (
      kind(ctx, node) === "non_null_expression" &&
      !needsParens(node, ctx)
    ) {
      printedNodes.unshift({
        node,
        printed: capture(() =>
          withComments(sctx, node, () =>
            sTok(
              ctx,
              childWhere(ctx, node, (c) => kind(ctx, c) === "!"),
            ),
          ),
        ),
      });
      rec(first(ctx, node) as number);
    } else {
      printedNodes.unshift({ node, printed: capture(() => sctx.print(node)) });
    }
  };

  printedNodes.unshift({
    node: n,
    printed: capture(() => {
      sOptional(ctx, n);
      sTypeArguments(sctx, n);
      sCallArguments(sctx, n);
    }),
  });
  const c = callee(ctx, n);
  if (c !== undefined) rec(c);

  const isComputedNumber = (x: number) =>
    kind(ctx, x) === "subscript_expression" &&
    kind(ctx, unparen(ctx, field(ctx, x, "index") as number)) === "number";
  const isCallNode = (x: number) => isCallExpression(ctx, x);
  const nodeOf = (i: number) => (printedNodes[i] as Printed).node;
  /**
   * `a.b // c⏎(1)`: oxfmt reads a comment ending the member's line, before the `(` on the next one, as the member's
   * trailing comment when it groups the chain, so the arguments start a group of their own, though the comment
   * prints inside them.
   */
  const argsAfterEndOfLineComment = (x: number) => {
    const list = argumentsNode(ctx, x);
    if (list === undefined || kind(ctx, unparen(ctx, callee(ctx, x) as number)) !== "member_expression") return false;
    const paren = firstLeaf(ctx.tree, list);
    let comment: number | undefined;
    for (let l = prevLeaf(ctx.tree, paren); l !== NO_NODE && kind(ctx, l) === "comment"; l = prevLeaf(ctx.tree, l))
      comment = l;
    return comment !== undefined && ctx.tree.lf(comment) === 0 && newlineBetween(ctx.tree, comment, paren);
  };

  /**
   * oxfmt's `has_comment_in_member`: a comment between a `.` member's object and property, or ending the member's
   * line, which alone of a chain's comments breaks it (`a[0] // c⏎(1).b()` stays one line, the comment after it).
   */
  const memberComment = (x: number) => {
    if (kind(ctx, x) !== "member_expression") return false;
    const t = ctx.tree;
    const property = field(ctx, x, "property");
    if (property === undefined) return false;
    for (let l = prevLeaf(t, property); l !== NO_NODE && (kind(ctx, l) === "comment" || /^\??\.$/.test(t.text(l))); l = prevLeaf(t, l))
      if (kind(ctx, l) === "comment") return true;
    for (let l = nextLeaf(t, x); l !== NO_NODE && kind(ctx, l) === "comment" && t.lf(l) === 0; l = nextLeaf(t, l)) {
      const after = nextLeaf(t, l);
      if (t.text(l).startsWith("//") || after === NO_NODE || t.lf(after) > 0) return true;
    }
    return false;
  };

  const groups: Printed[][] = [];
  let currentGroup: Printed[] = [printedNodes[0] as Printed];
  let i = 1;
  for (; i < printedNodes.length; ++i) {
    const x = nodeOf(i);
    if (
      kind(ctx, x) === "non_null_expression" ||
      isCallNode(x) ||
      isComputedNumber(x)
    )
      currentGroup.push(printedNodes[i] as Printed);
    else break;
  }
  if (!isCallNode(nodeOf(0))) {
    for (; i + 1 < printedNodes.length; ++i) {
      if (isMember(ctx, nodeOf(i)) && isMember(ctx, nodeOf(i + 1)))
        currentGroup.push(printedNodes[i] as Printed);
      else break;
    }
  }
  groups.push(currentGroup);
  currentGroup = [];
  let hasSeenCallExpression = false;
  for (; i < printedNodes.length; ++i) {
    const x = nodeOf(i);
    if (hasSeenCallExpression && isMember(ctx, x)) {
      if (isComputedNumber(x)) {
        currentGroup.push(printedNodes[i] as Printed);
        continue;
      }
      groups.push(currentGroup);
      currentGroup = [];
      hasSeenCallExpression = false;
    }
    if (isCallNode(x) && argsAfterEndOfLineComment(x) && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }
    if (isCallNode(x) || isDynamicImport(ctx, x)) hasSeenCallExpression = true;
    currentGroup.push(printedNodes[i] as Printed);
    if (hasComment(ctx, x, CF.Trailing)) {
      groups.push(currentGroup);
      currentGroup = [];
      hasSeenCallExpression = false;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  const shouldNotWrap = (gs: Printed[][]) => {
    const g1first = gs[1]?.[0]?.node;
    const hasComputed = kind(ctx, g1first) === "subscript_expression";
    const g0 = gs[0] as Printed[];
    if (g0.length === 1) {
      const firstNode = (g0[0] as Printed).node;
      const name = src(ctx, firstNode);
      return (
        kind(ctx, firstNode) === "this" ||
        (kind(ctx, firstNode) === "identifier" &&
          (isFactory(name) ||
            (isExpressionStatement && name.length <= ctx.options.tabWidth) ||
            hasComputed))
      );
    }
    const lastNode = (g0.at(-1) as Printed).node;
    const property =
      kind(ctx, lastNode) === "member_expression"
        ? field(ctx, lastNode, "property")
        : undefined;
    return (
      property !== undefined &&
      kind(ctx, property) === "property_identifier" &&
      (isFactory(src(ctx, property)) || hasComputed)
    );
  };

  const shouldMerge =
    groups.length >= 2 &&
    (groups[1] as Printed[]).length > 0 &&
    !memberComment((groups[1] as Printed[])[0]?.node as number) &&
    !(groups[1]?.length === 1 && groups[2]?.[0] !== undefined && argsAfterEndOfLineComment(groups[2][0].node)) &&
    shouldNotWrap(groups);

  const printGroup = (g: Printed[]) => {
    for (const x of g) place(x.printed);
  };
  const groupWillBreak = (g: Printed[]) => g.some((x) => willBreak(x.printed));
  const oneLine = () => groups.forEach(printGroup);

  const cutoff = shouldMerge ? 3 : 2;
  const flat = groups.flat();
  const nodeHasComment =
    flat.some((x) => isCallNode(x.node) && argsAfterEndOfLineComment(x.node)) ||
    flat.slice(1, -1).some((x) => hasComment(ctx, x.node, CF.Leading)) ||
    flat.some((x) => memberComment(x.node)) ||
    (groups[cutoff] !== undefined &&
      hasComment(ctx, groups[cutoff][0]?.node, CF.Leading));

  if (
    groups.length <= cutoff &&
    !nodeHasComment &&
    groups.every((g) => !g.at(-1)?.hasTrailingEmptyLine)
  ) {
    const grouped = !isLongCurriedCall(ctx, n);
    if (grouped) open(GROUP);
    oneLine();
    if (grouped) close();
    return;
  }

  const lastNodeBeforeIndent = (groups[shouldMerge ? 1 : 0] as Printed[]).at(-1)
    ?.node as number;
  const shouldHaveEmptyLineBeforeIndent =
    !isCallNode(lastNodeBeforeIndent) &&
    shouldInsertEmptyLineAfter(lastNodeBeforeIndent);

  const expanded = () => {
    printGroup(groups[0] as Printed[]);
    if (shouldMerge) groups.slice(1, 2).forEach(printGroup);
    if (shouldHaveEmptyLineBeforeIndent) sHardline();
    const indented = groups.slice(shouldMerge ? 2 : 1);
    if (indented.length === 0) return;
    open(INDENT);
    sHardline();
    indented.forEach((g, j) => {
      if (j > 0) sHardline();
      printGroup(g);
    });
    close();
  };

  const callExpressions = printedNodes.map((x) => x.node).filter(isCallNode);
  const lastGroupWillBreakAndOtherCallsHaveFunctionArguments = () => {
    const lastGroup = groups.at(-1) as Printed[];
    const lastGroupNode = lastGroup.at(-1)?.node;
    return (
      lastGroupNode !== undefined &&
      isCallNode(lastGroupNode) &&
      groupWillBreak(lastGroup) &&
      callExpressions
        .slice(0, -1)
        .some((x) =>
          callArguments(ctx, x).some((a) =>
            isFunctionOrArrow(ctx, unparen(ctx, a)),
          ),
        )
    );
  };

  if (
    nodeHasComment ||
    (callExpressions.length > 2 &&
      callExpressions.some((x) =>
        callArguments(ctx, x).some((a) => !isSimpleCallArgument(ctx, a)),
      )) ||
    groups.slice(0, -1).some(groupWillBreak) ||
    lastGroupWillBreakAndOtherCallsHaveFunctionArguments()
  ) {
    open(GROUP);
    expanded();
    close();
  } else {
    if (groups.some(groupWillBreak) || shouldHaveEmptyLineBeforeIndent)
      sBreakParent();
    sConditionalGroup([oneLine, expanded]);
  }
  markMemberChain(ctx, n);
}

// --- calls --------------------------------------------------------------------------------------------------

const MODULE_IMPORT_CALLEES = new Set([
  "require",
  "require.resolve",
  "require.resolve.paths",
  "import.meta.resolve",
]);

function isSimpleModuleImport(ctx: JsCtx, n: number): boolean {
  const c = callee(ctx, n);
  if (
    !(
      isDynamicImport(ctx, n) ||
      (isCallExpression(ctx, n) &&
        !isOptionalCall(ctx, n) &&
        MODULE_IMPORT_CALLEES.has(dottedName(ctx, c) ?? ""))
    )
  )
    return false;
  const args = callArguments(ctx, n);
  return (
    args.length === 1 &&
    kind(ctx, args[0]) === "string" &&
    !hasComment(ctx, args[0])
  );
}

function isCommonJsOrAmdModuleDefinition(ctx: JsCtx, n: number): boolean {
  if (!isCallExpression(ctx, n) || isOptionalCall(ctx, n)) return false;
  const c = callee(ctx, n);
  if (c === undefined || kind(ctx, c) !== "identifier") return false;
  const args = callArguments(ctx, n);
  const name = src(ctx, c);
  if (name === "require")
    return (
      ((args.length === 1 && kind(ctx, args[0]) === "string") ||
        args.length > 1) &&
      !hasComment(ctx, args[0])
    );
  if (
    name === "define" &&
    kind(ctx, role(ctx, n).parent) === "expression_statement"
  )
    return (
      args.length === 1 ||
      (args.length === 2 && kind(ctx, args[0]) === "array") ||
      (args.length === 3 &&
        kind(ctx, args[0]) === "string" &&
        kind(ctx, args[1]) === "array")
    );
  return false;
}

/** The callee, after `new ` for a new expression. */
const sCallee = (sctx: JsStreamCtx, n: number) => {
  const ctx = sctx.js;
  if (kind(ctx, n) === "new_expression") {
    sTok(
      ctx,
      childWhere(ctx, n, (c) => kind(ctx, c) === "new"),
    );
    sText(" ");
  }
  const c = callee(ctx, n);
  if (c !== undefined) sctx.print(c);
  // `await (x).y` in an async function: tree-sitter reads a call of `await`, babel an await of `(x).y`.
  if (
    c !== undefined &&
    kind(ctx, c) === "identifier" &&
    src(ctx, c) === "await" &&
    awaitsHere(ctx, n)
  )
    sText(" ");
  // oxfmt carries a callee's trailing comment past its type arguments and arguments to the line's end: `f<T>();⏎// c`.
};

/** Prettier's printCallExpression, for calls and `new`. */
const callCustom: CustomRule<JsOptions> = (n, s) => {
  const sctx = jsCtx(s);
  const ctx = sctx.js;
  if (isTaggedTemplate(ctx, n)) {
    const c = callee(ctx, n);
    if (c !== undefined) sctx.print(c);
    sTypeArguments(sctx, n);
    const template = field(ctx, n, "arguments");
    // printTaggedTemplateLiteral: the template's leading comment stands apart from the tag, on its own line when
    // it started one.
    const comment = template === undefined ? undefined : sctx.leadingComments(template)[0];
    const tag = field(ctx, n, "type_arguments") ?? c;
    // oxfmt keeps the line break after a block comment trailing the tag: `foo /* c */⏎`x``.
    const tagComment = tag === undefined ? undefined : sctx.trailingComments(tag).at(-1);
    if (
      tagComment !== undefined &&
      !ctx.isLineComment(tagComment) &&
      ctx.tree.lf(nextLeaf(ctx.tree, tagComment)) > 0
    )
      sHardline();
    else if (comment !== undefined && tag !== undefined) {
      if (newlineBetween(ctx.tree, prevLeaf(ctx.tree, nextLeaf(ctx.tree, tag)), comment)) sHardline();
      else sText(" ");
    }
    sLineSuffixBoundary();
    if (template !== undefined) sctx.print(template);
    return;
  }
  const args = callArguments(ctx, n);
  const typeArgs = capture(() => sTypeArguments(sctx, n));
  const list = argumentsNode(ctx, n);
  if (
    list !== undefined &&
    ctx.comments(list).dangling.length === 0 &&
    ((args.length === 1 && isTemplateOnItsOwnLine(ctx, args[0] as number)) ||
      isSimpleModuleImport(ctx, n) ||
      isCommonJsOrAmdModuleDefinition(ctx, n) ||
      isTestCall(ctx, n, role(ctx, n).parent))
  ) {
    const commas = separators(ctx, list, args);
    sCallee(sctx, n);
    sOptional(ctx, n);
    place(typeArgs);
    withComments(sctx, list, () => {
      sTok(
        ctx,
        childWhere(ctx, list, (c) => kind(ctx, c) === "("),
      );
      args.forEach((a, i) => {
        sctx.print(a);
        if (i === args.length - 1) return;
        sTok(ctx, commas.get(a));
        sText(" ");
      });
      sTok(
        ctx,
        lastChildWhere(ctx, list, (c) => kind(ctx, c) === ")"),
      );
    });
    return;
  }
  const c = callee(ctx, n);
  if (
    kind(ctx, n) === "call_expression" &&
    !isDynamicImport(ctx, n) &&
    c !== undefined &&
    isMember(ctx, unparen(ctx, c)) &&
    !needsParens(unparen(ctx, c), ctx)
  )
    return sMemberChain(sctx, n);
  const grouped =
    isDynamicImport(ctx, n) ||
    (c !== undefined && isCallExpression(ctx, unparen(ctx, c)));
  if (grouped) open(GROUP);
  sCallee(sctx, n);
  sOptional(ctx, n);
  place(typeArgs);
  sCallArguments(sctx, n);
  if (grouped) close();
};

/** The customs format/calls.ts names, by the names its spec gives them. */
export const callCustoms = {
  call: (n, s) => {
    callCustom(n, s);
    // babel calls a V8 intrinsic where it stands, `%F(x)`, so `new %F(x)` constructs that call with no arguments.
    const ctx = jsCtx(s).js;
    if (
      kind(ctx, n) === "new_expression" &&
      kind(ctx, callee(ctx, n)) === "v8_intrinsic" &&
      !(isCall(ctx, parent(ctx, n)) && callee(ctx, parent(ctx, n) as number) === n)
    )
      sText("()");
  },
  member: memberCustom,
} satisfies Record<string, CustomRule<JsOptions>>;
