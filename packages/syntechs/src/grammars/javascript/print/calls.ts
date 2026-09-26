// Prettier's call and member printers: call-expression.js, member.js, member-chain.js, call-arguments.js, and
// the utilities they lean on (is-simple-call-argument.js, test-libraries.js, is-long-curried-call-expression.js,
// is-function-composition-arguments.js, is-template-on-its-own-line.js).

import {
  breakParent,
  conditionalGroup,
  type Doc,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  line,
  lineSuffixBoundary,
  softline,
  synthetic,
  text,
  willBreak,
} from "../../../fmt/doc.js";
import { hasNewline, isNextLineEmpty } from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { needsParens, role } from "./parens.js";
import {
  ArgExpansionBailout,
  argument,
  CF,
  callArguments,
  callee,
  danglingCommentsInList,
  estreeType,
  field,
  first,
  hasComment,
  isCall,
  isConciselyPrintedArray,
  isFunctionOrArrow,
  isJsx,
  isMember,
  isOptionalChainToken,
  isTaggedTemplate,
  items,
  type JsCtx,
  type JsRule,
  nextCodeIndex,
  objectOf,
  operator,
  p,
  parameters,
  separators,
  src,
  t,
  trailingCommaAllowed,
  unparen,
} from "./util.js";

// Prettier labels a member chain's doc so that an assignment and a member lookup can see it; here the label is
// kept per printed node.
const memberChains = new WeakMap<JsCtx, WeakSet<FormatNode>>();
function markMemberChain(ctx: JsCtx, n: FormatNode) {
  let set = memberChains.get(ctx);
  if (!set) {
    set = new WeakSet();
    memberChains.set(ctx, set);
  }
  set.add(n);
}

/** Whether `n` prints as a member chain (prettier's `label.memberChain` on its doc). */
export function printsAsMemberChain(ctx: JsCtx, n: FormatNode): boolean {
  const inner = unparen(n);
  ctx.print(inner);
  return memberChains.get(ctx)?.has(inner) ?? false;
}

/** A call proper: not a tagged template, not `import(...)`. */
const isCallExpression = (n: FormatNode | undefined) =>
  isCall(n) && callee(n as FormatNode)?.kind !== "import";

const isDynamicImport = (n: FormatNode) =>
  n.kind === "call_expression" && callee(n)?.kind === "import";

const isCallLike = (n: FormatNode) => isCall(n) || n.kind === "new_expression";

const optionalToken = (ctx: JsCtx, n: FormatNode): Doc =>
  t(ctx, n.children.find(isOptionalChainToken));

const typeArguments = (ctx: JsCtx, n: FormatNode): Doc => {
  const ta = field(n, "type_arguments");
  return ta ? [p(ctx, ta), lineSuffixBoundary] : [];
};

/** The arguments list node of a call (its comments are printed with the arguments). */
const argumentsNode = (n: FormatNode) => {
  const a = field(n, "arguments");
  return a?.kind === "arguments" ? a : undefined;
};

// --- utilities ----------------------------------------------------------------------------------------------

/** The dotted name of a callee made of identifiers (`describe.only`), else undefined. */
function dottedName(ctx: JsCtx, n: FormatNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.kind === "identifier") return src(ctx, n);
  if (n.kind === "meta_property") return src(ctx, n).replaceAll(/\s/g, "");
  if (
    n.kind === "member_expression" &&
    !n.children.some(isOptionalChainToken)
  ) {
    const object = dottedName(ctx, objectOf(n));
    const property = field(n, "property");
    if (object === undefined || property?.kind !== "property_identifier")
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

const isOptionalCall = (n: FormatNode) => n.children.some(isOptionalChainToken);

function isAngularTestWrapper(ctx: JsCtx, n: FormatNode | undefined): boolean {
  if (!n || !isCallExpression(n)) return false;
  const c = callee(n);
  return (
    c?.kind === "identifier" &&
    ["async", "inject", "fakeAsync", "waitForAsync"].includes(src(ctx, c))
  );
}

const hasBlockBody = (n: FormatNode) =>
  n.kind === "function_expression" ||
  n.kind === "generator_function" ||
  (n.kind === "arrow_function" && field(n, "body")?.kind === "statement_block");

/** Prettier's isTestCall. */
export function isTestCall(
  ctx: JsCtx,
  n: FormatNode | undefined,
  parent?: FormatNode,
): boolean {
  if (!n || !isCallExpression(n) || isOptionalCall(n)) return false;
  const args = callArguments(n).map(unparen);
  const c = callee(n);
  if (args.length === 1) {
    if (isAngularTestWrapper(ctx, n) && isTestCall(ctx, parent))
      return isFunctionOrArrow(args[0]);
    if (
      c?.kind === "identifier" &&
      ["beforeEach", "beforeAll", "afterEach", "afterAll"].includes(src(ctx, c))
    )
      return isAngularTestWrapper(ctx, args[0]);
  } else if (
    (args.length === 2 || args.length === 3) &&
    (args[0]?.kind === "template_string" || args[0]?.kind === "string") &&
    TEST_CALLEES.has(dottedName(ctx, c) ?? "")
  ) {
    const [, second, third] = args;
    if (third && third.kind !== "number") return false;
    if (!second) return false;
    return (
      (args.length === 2
        ? isFunctionOrArrow(second)
        : hasBlockBody(second) && parameters(second).length <= 1) ||
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
  node: FormatNode,
  depth = 2,
): boolean {
  if (depth <= 0) return false;
  const n = unparen(node);
  const child = (c: FormatNode) => isSimpleCallArgument(ctx, c, depth - 1);
  if (n.kind === "regex") {
    const pattern = field(n, "pattern");
    return pattern ? [...src(ctx, pattern)].length <= 5 : true;
  }
  if (LITERALS.has(n.kind) || SINGLE_WORD.has(n.kind)) return true;
  if (n.kind === "template_string")
    return n.children.every((c) =>
      c.kind === "template_substitution"
        ? (() => {
            const e = first(c);
            return e !== undefined && child(e);
          })()
        : c.kind === "comment" || !src(ctx, c).includes("\n"),
    );
  if (n.kind === "object")
    return items(n).every((prop) => {
      if (prop.kind === "shorthand_property_identifier") return true;
      if (prop.kind !== "pair") return false;
      const key = field(prop, "key");
      const value = field(prop, "value");
      return (
        key?.kind !== "computed_property_name" &&
        value !== undefined &&
        child(value)
      );
    });
  if (n.kind === "array") return items(n).every(child);
  if (isDynamicImport(n)) {
    const args = callArguments(n);
    return args.length <= depth && args.every(child);
  }
  if (isCallLike(n)) {
    const c = callee(n);
    if (c && isSimpleCallArgument(ctx, c, depth)) {
      const args = callArguments(n);
      return args.length <= depth && args.every(child);
    }
    return false;
  }
  if (isMember(n)) {
    const object = objectOf(n);
    const property = field(n, "property") ?? field(n, "index");
    return (
      object !== undefined &&
      property !== undefined &&
      isSimpleCallArgument(ctx, object, depth) &&
      isSimpleCallArgument(ctx, property, depth)
    );
  }
  if (n.kind === "non_null_expression") {
    const e = first(n);
    return e !== undefined && isSimpleCallArgument(ctx, e, depth);
  }
  if (
    (n.kind === "unary_expression" && SIMPLE_UNARY.has(operator(n))) ||
    n.kind === "update_expression"
  ) {
    const a = argument(n);
    return a !== undefined && isSimpleCallArgument(ctx, a, depth);
  }
  return false;
}

/** Prettier's isLongCurriedCallExpression: `a(1)(2, 3)` seen from `a(1)`. */
function isLongCurriedCall(n: FormatNode): boolean {
  const { parent, key } = role(n);
  return (
    key === "callee" &&
    isCallExpression(n) &&
    parent !== undefined &&
    isCallExpression(parent) &&
    callArguments(parent).length > 0 &&
    callArguments(n).length > callArguments(parent).length
  );
}

function isFunctionCompositionArguments(args: readonly FormatNode[]): boolean {
  if (args.length <= 1) return false;
  let count = 0;
  for (const raw of args) {
    const arg = unparen(raw);
    if (isFunctionOrArrow(arg)) {
      count += 1;
      if (count > 1) return true;
    } else if (isCallExpression(arg)) {
      if (callArguments(arg).some((a) => isFunctionOrArrow(unparen(a))))
        return true;
    }
  }
  return false;
}

const templateHasNewLines = (ctx: JsCtx, n: FormatNode) =>
  n.children.some(
    (c) =>
      c.kind !== "template_substitution" &&
      c.kind !== "comment" &&
      src(ctx, c).includes("\n"),
  );

/** Prettier's isTemplateOnItsOwnLine. */
export function isTemplateOnItsOwnLine(ctx: JsCtx, n: FormatNode): boolean {
  const template =
    n.kind === "template_string"
      ? n
      : isTaggedTemplate(n)
        ? field(n, "arguments")
        : undefined;
  return (
    template !== undefined &&
    templateHasNewLines(ctx, template) &&
    !hasNewline(ctx.source, n.start, true)
  );
}

const CAST_KINDS = new Set([
  "as_expression",
  "satisfies_expression",
  "type_assertion",
]);

/** The expression of `x as T`, `x satisfies T`, `<T>x`. */
const castExpression = (n: FormatNode) =>
  n.kind === "type_assertion" ? items(n).at(-1) : first(n);

/** Prettier's couldExpandArg. */
export function couldExpandArg(
  ctx: JsCtx,
  raw: FormatNode,
  arrowChainRecursion = false,
): boolean {
  const arg = unparen(raw);
  if (arg.kind === "object" && (items(arg).length > 0 || hasComment(ctx, arg)))
    return true;
  if (arg.kind === "array" && (items(arg).length > 0 || hasComment(ctx, arg)))
    return true;
  if (CAST_KINDS.has(arg.kind)) {
    const e = castExpression(arg);
    return e !== undefined && couldExpandArg(ctx, e);
  }
  if (arg.kind === "function_expression" || arg.kind === "generator_function")
    return true;
  if (arg.kind === "arrow_function") {
    const bodyNode = field(arg, "body");
    if (!bodyNode) return false;
    const body = unparen(bodyNode);
    if (
      body.kind === "statement_block" ||
      isJsx(body) ||
      body.kind === "object" ||
      body.kind === "array"
    )
      return true;
    if (body.kind === "arrow_function" && couldExpandArg(ctx, body, true))
      return true;
    if (!arrowChainRecursion) {
      if (body.kind === "ternary_expression") return true;
      if (isCallExpression(body)) return true;
    }
  }
  return false;
}

const SIMPLE_TYPE_KINDS = new Set([
  "predefined_type",
  "type_identifier",
  "literal_type",
  "this_type",
]);

/** Prettier's isSimpleType over a type node. */
function isSimpleType(n: FormatNode | undefined): boolean {
  if (!n) return false;
  if (SIMPLE_TYPE_KINDS.has(n.kind)) return true;
  if (n.kind === "generic_type") return false;
  if (n.kind === "nested_type_identifier") return true;
  return false;
}

function isHopefullyShortCallArgument(ctx: JsCtx, raw: FormatNode): boolean {
  const n = unparen(raw);
  if (n.kind === "as_expression" || n.kind === "satisfies_expression") {
    let type = items(n).at(-1);
    if (type?.kind === "array_type") {
      type = first(type);
      if (type?.kind === "array_type") type = first(type);
    }
    if (type?.kind === "generic_type") {
      const ta = field(type, "type_arguments");
      const params = ta ? items(ta) : [];
      if (params.length === 1) type = params[0];
    }
    const e = first(n);
    return (
      isSimpleType(type) && e !== undefined && isSimpleCallArgument(ctx, e, 1)
    );
  }
  if (isCallLike(n) && callArguments(n).length > 1) return false;
  if (n.kind === "binary_expression") {
    const left = field(n, "left");
    const right = field(n, "right");
    return (
      left !== undefined &&
      right !== undefined &&
      isSimpleCallArgument(ctx, left, 1) &&
      isSimpleCallArgument(ctx, right, 1)
    );
  }
  return n.kind === "regex" || isSimpleCallArgument(ctx, n);
}

function shouldExpandFirstArg(
  ctx: JsCtx,
  args: readonly FormatNode[],
): boolean {
  if (args.length !== 2) return false;
  const [firstRaw, secondRaw] = args as [FormatNode, FormatNode];
  const firstArg = unparen(firstRaw);
  const second = unparen(secondRaw);
  return (
    !hasComment(ctx, firstRaw) &&
    !hasComment(ctx, firstArg) &&
    hasBlockBody(firstArg) &&
    !isFunctionOrArrow(second) &&
    second.kind !== "ternary_expression" &&
    isHopefullyShortCallArgument(ctx, second) &&
    !couldExpandArg(ctx, second)
  );
}

function shouldExpandLastArg(ctx: JsCtx, args: readonly FormatNode[]): boolean {
  const lastRaw = args.at(-1);
  if (!lastRaw) return false;
  const last = unparen(lastRaw);
  const penultimate = args.at(-2) && unparen(args.at(-2) as FormatNode);
  return (
    !hasComment(ctx, lastRaw, CF.Leading) &&
    !hasComment(ctx, lastRaw, CF.Trailing) &&
    !hasComment(ctx, last, CF.Leading) &&
    !hasComment(ctx, last, CF.Trailing) &&
    couldExpandArg(ctx, last) &&
    (!penultimate || estreeType(penultimate) !== estreeType(last)) &&
    (args.length !== 2 ||
      penultimate?.kind !== "arrow_function" ||
      last.kind !== "array") &&
    !(args.length > 1 && isConciselyPrintedArray(ctx, last))
  );
}

function isReactHookCallWithDepsArray(
  ctx: JsCtx,
  raw: readonly FormatNode[],
): boolean {
  const args = raw.map(unparen);
  const valid = (base: number) => {
    const fn = args[base];
    const deps = args[base + 1];
    return (
      fn?.kind === "arrow_function" &&
      parameters(fn).length === 0 &&
      field(fn, "body")?.kind === "statement_block" &&
      deps?.kind === "array" &&
      raw.every((a) => !hasComment(ctx, a))
    );
  };
  if (args.length === 2) return valid(0);
  if (args.length === 3) return args[0]?.kind === "identifier" && valid(1);
  return false;
}

// --- call arguments -----------------------------------------------------------------------------------------

/** Prettier's printCallArguments over the call (or new expression) `n`. */
export function printCallArguments(ctx: JsCtx, n: FormatNode): Doc {
  const list = argumentsNode(n);
  if (!list) {
    // `new A` prints as `new A()`.
    return n.kind === "new_expression"
      ? [synthetic(n, "("), synthetic(n, ")")]
      : [];
  }
  return ctx.withComments(list, argumentsDoc(ctx, n, list));
}

function argumentsDoc(ctx: JsCtx, n: FormatNode, list: FormatNode): Doc {
  const open = t(
    ctx,
    list.children.find((c) => c.kind === "("),
  );
  const close = t(
    ctx,
    list.children.findLast((c) => c.kind === ")"),
  );
  const args = items(list);
  if (args.length === 0)
    return group([open, danglingCommentsInList(ctx, list), close]);
  const commas = separators(list, args);
  const comma = (a: FormatNode) => t(ctx, commas.get(a));
  const lastIndex = args.length - 1;

  if (isReactHookCallWithDepsArray(ctx, args)) {
    return [
      open,
      args.map((a, i) => [
        p(ctx, a),
        i === lastIndex ? [] : [comma(a), text(" ")],
      ]),
      close,
    ];
  }

  let anyArgEmptyLine = false;
  const printedArguments = args.map((a, i): Doc => {
    const doc = p(ctx, a);
    if (i === lastIndex) return doc;
    if (isNextLineEmpty(ctx.source, a.end)) {
      anyArgEmptyLine = true;
      return [doc, comma(a), hardline, hardline];
    }
    return [doc, comma(a), line];
  });
  const last = args[lastIndex] as FormatNode;
  const trailing =
    !isDynamicImport(n) && trailingCommaAllowed(ctx, "all")
      ? ifBreakComma(last)
      : [];

  const allArgsBrokenOut = () =>
    group(
      [open, indent([line, ...printedArguments]), trailing, line, close],
      true,
    );

  if (
    anyArgEmptyLine ||
    (role(n).parent?.kind !== "decorator" &&
      isFunctionCompositionArguments(args))
  )
    return allArgsBrokenOut();

  if (shouldExpandFirstArg(ctx, args)) {
    const tail = printedArguments.slice(1);
    if (tail.some(willBreak)) return allArgsBrokenOut();
    const firstArg = args[0] as FormatNode;
    let firstDoc: Doc;
    try {
      firstDoc = p(ctx, firstArg, { expandFirstArg: true });
    } catch (caught) {
      if (caught instanceof ArgExpansionBailout) return allArgsBrokenOut();
      throw caught;
    }
    const sep = [comma(firstArg), text(" ")];
    if (willBreak(firstDoc))
      return [
        breakParent,
        conditionalGroup([
          [open, group(firstDoc, true), sep, ...tail, close],
          allArgsBrokenOut(),
        ]),
      ];
    return conditionalGroup([
      [open, firstDoc, sep, ...tail, close],
      [open, group(firstDoc, true), sep, ...tail, close],
      allArgsBrokenOut(),
    ]);
  }

  if (shouldExpandLastArg(ctx, args)) {
    const head = printedArguments.slice(0, -1);
    if (head.some(willBreak)) return allArgsBrokenOut();
    let lastDoc: Doc;
    try {
      lastDoc = p(ctx, last, { expandLastArg: true });
    } catch (caught) {
      if (caught instanceof ArgExpansionBailout) return allArgsBrokenOut();
      throw caught;
    }
    if (willBreak(lastDoc))
      return [
        breakParent,
        conditionalGroup([
          [open, ...head, group(lastDoc, true), close],
          allArgsBrokenOut(),
        ]),
      ];
    return conditionalGroup([
      [open, ...head, lastDoc, close],
      [open, ...head, group(lastDoc, true), close],
      allArgsBrokenOut(),
    ]);
  }

  const contents = [
    open,
    indent([softline, ...printedArguments]),
    trailing,
    softline,
    close,
  ];
  if (isLongCurriedCall(n)) return contents;
  return group(contents, printedArguments.some(willBreak) || anyArgEmptyLine);
}

const ifBreakComma = (anchor: FormatNode): Doc =>
  ifBreak(synthetic(anchor, ","));

// --- member expressions -------------------------------------------------------------------------------------

/** Prettier's printMemberLookup: `.b`, `?.b`, `[0]`, `[key]`. */
function printMemberLookup(ctx: JsCtx, n: FormatNode): Doc {
  const optional = optionalToken(ctx, n);
  if (n.kind === "member_expression") {
    const property = field(n, "property");
    return [
      optional,
      t(
        ctx,
        n.children.find((c) => c.kind === "."),
      ),
      p(ctx, property),
    ];
  }
  const index = field(n, "index");
  const open = t(
    ctx,
    n.children.find((c) => c.kind === "["),
  );
  const close = t(
    ctx,
    n.children.findLast((c) => c.kind === "]"),
  );
  if (!index || unparen(index).kind === "number")
    return [optional, open, p(ctx, index), close];
  return group([
    optional,
    open,
    indent([softline, p(ctx, index)]),
    softline,
    close,
  ]);
}

/** Up through members (as their object) and non-null assertions, whether `n` is the callee of a `new`. */
function isNewCallee(n: FormatNode): boolean {
  let child = n;
  for (;;) {
    const { parent, key } = role(child);
    if (!parent) return false;
    if (
      (isMember(parent) && key === "object") ||
      parent.kind === "non_null_expression"
    ) {
      child = parent;
      continue;
    }
    return parent.kind === "new_expression" && key === "callee";
  }
}

const member: JsRule = (n, ctx) => {
  const object = objectOf(n);
  const objectDoc = p(ctx, object);
  const lookup = printMemberLookup(ctx, n);
  let firstNonMember = role(n);
  while (
    firstNonMember.parent &&
    (isMember(firstNonMember.parent) ||
      firstNonMember.parent.kind === "non_null_expression")
  )
    firstNonMember = role(firstNonMember.parent);
  const parent = role(n).parent;
  const property = field(n, "property");
  const inner = object && unparen(object);
  const fnp = firstNonMember.parent;
  const shouldInline =
    (fnp?.kind === "assignment_expression" ||
    fnp?.kind === "augmented_assignment_expression"
      ? unparen(field(fnp, "left") as FormatNode).kind !== "identifier"
      : false) ||
    isNewCallee(n) ||
    n.kind === "subscript_expression" ||
    (inner?.kind === "identifier" &&
      property?.kind === "property_identifier" &&
      !isMember(parent)) ||
    ((parent?.kind === "assignment_expression" ||
      parent?.kind === "variable_declarator") &&
      inner !== undefined &&
      ((isCallExpression(inner) && callArguments(inner).length > 0) ||
        printsAsMemberChain(ctx, inner)));
  if (inner && memberChains.get(ctx)?.has(inner)) markMemberChain(ctx, n);
  return [
    objectDoc,
    lineSuffixBoundary,
    shouldInline ? lookup : group(indent([softline, lookup])),
  ];
};

// --- member chains ------------------------------------------------------------------------------------------

interface Printed {
  node: FormatNode;
  printed: Doc;
  hasTrailingEmptyLine?: boolean;
}

const isFactory = (name: string) => /^[A-Z]|^[$_]+$/.test(name);

/** Prettier's printMemberChain for call `n` whose callee is a member. */
function printMemberChain(ctx: JsCtx, n: FormatNode): Doc {
  const top = role(n);
  const isExpressionStatement = top.parent?.kind === "expression_statement";
  const printedNodes: Printed[] = [];

  const shouldInsertEmptyLineAfter = (node: FormatNode) => {
    const next = nextCodeIndex(ctx.source, node.end);
    if (ctx.source.charAt(next) === ")")
      return isNextLineEmpty(ctx.source, next + 1);
    return isNextLineEmpty(ctx.source, node.end);
  };

  const rec = (node: FormatNode) => {
    if (node.kind === "parenthesized_expression") {
      const inner = unparen(node);
      const kept =
        hasComment(ctx, node) ||
        node.children.some((c) => c.kind === "comment") ||
        needsParens(inner, ctx);
      if (!kept) return rec(inner);
      printedNodes.unshift({ node, printed: ctx.print(node) });
      return;
    }
    if (
      isCallExpression(node) &&
      (isMember(unparen(callee(node) as FormatNode)) ||
        isCallExpression(unparen(callee(node) as FormatNode))) &&
      !needsParens(node, ctx)
    ) {
      const hasTrailingEmptyLine = shouldInsertEmptyLineAfter(node);
      printedNodes.unshift({
        node,
        hasTrailingEmptyLine,
        printed: [
          ctx.withComments(node, [
            optionalToken(ctx, node),
            typeArguments(ctx, node),
            printCallArguments(ctx, node),
          ]),
          hasTrailingEmptyLine ? hardline : [],
        ],
      });
      rec(callee(node) as FormatNode);
    } else if (isMember(node) && !needsParens(node, ctx)) {
      printedNodes.unshift({
        node,
        printed: ctx.withComments(node, printMemberLookup(ctx, node)),
      });
      rec(objectOf(node) as FormatNode);
    } else if (node.kind === "non_null_expression" && !needsParens(node, ctx)) {
      printedNodes.unshift({
        node,
        printed: ctx.withComments(
          node,
          t(
            ctx,
            node.children.find((c) => c.kind === "!"),
          ),
        ),
      });
      rec(first(node) as FormatNode);
    } else {
      printedNodes.unshift({ node, printed: ctx.print(node) });
    }
  };

  printedNodes.unshift({
    node: n,
    printed: [
      optionalToken(ctx, n),
      typeArguments(ctx, n),
      printCallArguments(ctx, n),
    ],
  });
  const c = callee(n);
  if (c) rec(c);

  const isComputedNumber = (x: FormatNode) =>
    x.kind === "subscript_expression" &&
    unparen(field(x, "index") as FormatNode).kind === "number";
  const isCallNode = (x: FormatNode) => isCallExpression(x);
  const nodeOf = (i: number) => (printedNodes[i] as Printed).node;

  const groups: Printed[][] = [];
  let currentGroup: Printed[] = [printedNodes[0] as Printed];
  let i = 1;
  for (; i < printedNodes.length; ++i) {
    const x = nodeOf(i);
    if (
      x.kind === "non_null_expression" ||
      isCallNode(x) ||
      isComputedNumber(x)
    )
      currentGroup.push(printedNodes[i] as Printed);
    else break;
  }
  if (!isCallNode(nodeOf(0))) {
    for (; i + 1 < printedNodes.length; ++i) {
      if (isMember(nodeOf(i)) && isMember(nodeOf(i + 1)))
        currentGroup.push(printedNodes[i] as Printed);
      else break;
    }
  }
  groups.push(currentGroup);
  currentGroup = [];
  let hasSeenCallExpression = false;
  for (; i < printedNodes.length; ++i) {
    const x = nodeOf(i);
    if (hasSeenCallExpression && isMember(x)) {
      if (isComputedNumber(x)) {
        currentGroup.push(printedNodes[i] as Printed);
        continue;
      }
      groups.push(currentGroup);
      currentGroup = [];
      hasSeenCallExpression = false;
    }
    if (isCallNode(x) || isDynamicImport(x)) hasSeenCallExpression = true;
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
    const hasComputed = g1first?.kind === "subscript_expression";
    const g0 = gs[0] as Printed[];
    if (g0.length === 1) {
      const firstNode = (g0[0] as Printed).node;
      const name = src(ctx, firstNode);
      return (
        firstNode.kind === "this" ||
        (firstNode.kind === "identifier" &&
          (isFactory(name) ||
            (isExpressionStatement && name.length <= ctx.options.tabWidth) ||
            hasComputed))
      );
    }
    const lastNode = (g0.at(-1) as Printed).node;
    const property =
      lastNode.kind === "member_expression"
        ? field(lastNode, "property")
        : undefined;
    return (
      property?.kind === "property_identifier" &&
      (isFactory(src(ctx, property)) || hasComputed)
    );
  };

  const shouldMerge =
    groups.length >= 2 &&
    (groups[1] as Printed[]).length > 0 &&
    !hasComment(ctx, (groups[1] as Printed[])[0]?.node) &&
    shouldNotWrap(groups);

  const printGroup = (g: Printed[]): Doc => g.map((x) => x.printed);
  const printIndentedGroup = (gs: Printed[][]): Doc =>
    gs.length === 0
      ? []
      : indent([hardline, join(hardline, gs.map(printGroup))]);

  const printedGroups = groups.map(printGroup);
  const oneLine: Doc = printedGroups;
  const cutoff = shouldMerge ? 3 : 2;
  const flat = groups.flat();
  const nodeHasComment =
    flat.slice(1, -1).some((x) => hasComment(ctx, x.node, CF.Leading)) ||
    flat.slice(0, -1).some((x) => hasComment(ctx, x.node, CF.Trailing)) ||
    (groups[cutoff] !== undefined &&
      hasComment(ctx, groups[cutoff][0]?.node, CF.Leading));

  if (
    groups.length <= cutoff &&
    !nodeHasComment &&
    groups.every((g) => !g.at(-1)?.hasTrailingEmptyLine)
  ) {
    return isLongCurriedCall(n) ? oneLine : group(oneLine);
  }

  const lastNodeBeforeIndent = (groups[shouldMerge ? 1 : 0] as Printed[]).at(-1)
    ?.node as FormatNode;
  const shouldHaveEmptyLineBeforeIndent =
    !isCallNode(lastNodeBeforeIndent) &&
    shouldInsertEmptyLineAfter(lastNodeBeforeIndent);

  const expanded: Doc = [
    printGroup(groups[0] as Printed[]),
    shouldMerge ? groups.slice(1, 2).map(printGroup) : [],
    shouldHaveEmptyLineBeforeIndent ? hardline : [],
    printIndentedGroup(groups.slice(shouldMerge ? 2 : 1)),
  ];

  const callExpressions = printedNodes.map((x) => x.node).filter(isCallNode);
  const lastGroupWillBreakAndOtherCallsHaveFunctionArguments = () => {
    const lastGroupNode = (groups.at(-1) as Printed[]).at(-1)?.node;
    const lastGroupDoc = printedGroups.at(-1) as Doc;
    return (
      lastGroupNode !== undefined &&
      isCallNode(lastGroupNode) &&
      willBreak(lastGroupDoc) &&
      callExpressions
        .slice(0, -1)
        .some((x) =>
          callArguments(x).some((a) => isFunctionOrArrow(unparen(a))),
        )
    );
  };

  let result: Doc;
  if (
    nodeHasComment ||
    (callExpressions.length > 2 &&
      callExpressions.some((x) =>
        callArguments(x).some((a) => !isSimpleCallArgument(ctx, a)),
      )) ||
    printedGroups.slice(0, -1).some(willBreak) ||
    lastGroupWillBreakAndOtherCallsHaveFunctionArguments()
  ) {
    result = group(expanded);
  } else {
    result = [
      willBreak(oneLine) || shouldHaveEmptyLineBeforeIndent ? breakParent : [],
      conditionalGroup([oneLine, expanded]),
    ];
  }
  markMemberChain(ctx, n);
  return result;
}

// --- calls --------------------------------------------------------------------------------------------------

const MODULE_IMPORT_CALLEES = new Set([
  "require",
  "require.resolve",
  "require.resolve.paths",
  "import.meta.resolve",
]);

function isSimpleModuleImport(ctx: JsCtx, n: FormatNode): boolean {
  const c = callee(n);
  if (
    !(
      isDynamicImport(n) ||
      (isCallExpression(n) &&
        !isOptionalCall(n) &&
        MODULE_IMPORT_CALLEES.has(dottedName(ctx, c) ?? ""))
    )
  )
    return false;
  const args = callArguments(n);
  return (
    args.length === 1 && args[0]?.kind === "string" && !hasComment(ctx, args[0])
  );
}

function isCommonJsOrAmdModuleDefinition(ctx: JsCtx, n: FormatNode): boolean {
  if (!isCallExpression(n) || isOptionalCall(n)) return false;
  const c = callee(n);
  if (c?.kind !== "identifier") return false;
  const args = callArguments(n);
  const name = src(ctx, c);
  if (name === "require")
    return (
      ((args.length === 1 && args[0]?.kind === "string") || args.length > 1) &&
      !hasComment(ctx, args[0])
    );
  if (name === "define" && role(n).parent?.kind === "expression_statement")
    return (
      args.length === 1 ||
      (args.length === 2 && args[0]?.kind === "array") ||
      (args.length === 3 &&
        args[0]?.kind === "string" &&
        args[1]?.kind === "array")
    );
  return false;
}

const printCallee = (ctx: JsCtx, n: FormatNode): Doc => {
  const newKeyword =
    n.kind === "new_expression"
      ? [
          t(
            ctx,
            n.children.find((c) => c.kind === "new"),
          ),
          text(" "),
        ]
      : [];
  return [newKeyword, p(ctx, callee(n)), lineSuffixBoundary];
};

const call: JsRule = (n, ctx) => {
  if (isTaggedTemplate(n))
    return [
      p(ctx, callee(n)),
      typeArguments(ctx, n),
      lineSuffixBoundary,
      p(ctx, field(n, "arguments")),
    ];
  const optional = optionalToken(ctx, n);
  const args = callArguments(n);
  const typeArgs = typeArguments(ctx, n);
  const list = argumentsNode(n);
  if (
    list &&
    ctx.dangling(list).length === 0 &&
    ((args.length === 1 &&
      isTemplateOnItsOwnLine(ctx, args[0] as FormatNode)) ||
      isSimpleModuleImport(ctx, n) ||
      isCommonJsOrAmdModuleDefinition(ctx, n) ||
      isTestCall(ctx, n, role(n).parent))
  ) {
    const commas = separators(list, args);
    const open = t(
      ctx,
      list.children.find((c) => c.kind === "("),
    );
    const close = t(
      ctx,
      list.children.findLast((c) => c.kind === ")"),
    );
    return [
      printCallee(ctx, n),
      optional,
      typeArgs,
      ctx.withComments(list, [
        open,
        args.map((a, i) => [
          p(ctx, a),
          i === args.length - 1 ? [] : [t(ctx, commas.get(a)), text(" ")],
        ]),
        close,
      ]),
    ];
  }
  const c = callee(n);
  if (
    n.kind === "call_expression" &&
    !isDynamicImport(n) &&
    c !== undefined &&
    isMember(unparen(c)) &&
    !needsParens(unparen(c), ctx)
  )
    return printMemberChain(ctx, n);
  const contents = [
    printCallee(ctx, n),
    optional,
    typeArgs,
    printCallArguments(ctx, n),
  ];
  if (isDynamicImport(n) || (c !== undefined && isCallExpression(unparen(c))))
    return group(contents);
  return contents;
};

const nonNull: JsRule = (n, ctx) => [
  p(ctx, first(n)),
  t(
    ctx,
    n.children.find((c) => c.kind === "!"),
  ),
];

export const callRules: Record<string, JsRule> = {
  call_expression: call,
  new_expression: call,
  member_expression: member,
  subscript_expression: member,
  non_null_expression: nonNull,
};
