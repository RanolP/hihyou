// Prettier's expression printers for operators: binaryish.js, ternary-old.js, sequence-expression.js,
// await-expression.js, assignment expressions and the unary, update and yield cases of estree.js.

import {
  align,
  breakParent,
  type Doc,
  dedent,
  group,
  hardline,
  ifBreak,
  indent,
  indentIfBreak,
  join,
  line,
  softline,
  synthetic,
  text,
} from "../../../fmt/doc.js";
import type { FormatNode } from "../../../fmt/tree.js";
import {
  isLoneShortArgument,
  printAssignment,
  shouldInlineLogicalExpression,
} from "./assignment.js";
import { needsParens, role, shouldFlatten } from "./parens.js";
import { mappedClauseOf, typeNeedsParens } from "./types.js";
import {
  type Args,
  CF,
  callArguments,
  callee,
  field,
  getComments,
  hasComment,
  hasLeadingOwnLineComment,
  hasNewlineIn,
  isBlockComment,
  isJsx,
  isLogical,
  items,
  type JsCtx,
  type JsRule,
  operator,
  p,
  src,
  t,
  unparen,
} from "./util.js";

const anonKid = (n: FormatNode, kind: string) =>
  n.children.find((c) => !c.named && c.kind === kind);

const isBinary = (n: FormatNode | undefined) => n?.kind === "binary_expression";
/** Prettier's node type, where `&&`, `||` and `??` make a LogicalExpression. */
const estreeKind = (n: FormatNode | undefined) =>
  n && isBinary(n)
    ? isLogical(n)
      ? "LogicalExpression"
      : "BinaryExpression"
    : n?.kind;
const isCallOrNew = (n: FormatNode | undefined) =>
  n?.kind === "call_expression" || n?.kind === "new_expression";
const isReturnOrThrow = (n: FormatNode | undefined) =>
  n?.kind === "return_statement" || n?.kind === "throw_statement";

const flatten = (d: Doc): Doc[] =>
  Array.isArray(d) ? d.flatMap(flatten) : [d as Doc];

// --- binaryish -------------------------------------------------------------------------------------------------

function printBinaryishExpressions(
  ctx: JsCtx,
  node: FormatNode,
  isNested: boolean,
  isInsideParenthesis: boolean,
): Doc[] {
  const left = field(node, "left") as FormatNode;
  const right = field(node, "right") as FormatNode;
  const leftInner = unparen(left);
  const op = operator(node);
  let parts: Doc[] = [];
  if (isBinary(leftInner) && shouldFlatten(op, operator(leftInner))) {
    let nested = printBinaryishExpressions(
      ctx,
      leftInner,
      true,
      isInsideParenthesis,
    );
    if (left !== leftInner && hasComment(ctx, left))
      nested = flatten(ctx.withComments(left, nested));
    parts = nested;
  } else parts.push(group(p(ctx, left)));

  const shouldInline = shouldInlineLogicalExpression(node);
  const opDoc = t(ctx, field(node, "operator"));
  const atStart = ctx.options.experimentalOperatorPosition === "start";
  const commentBeforeOperator = hasLeadingOwnLineComment(ctx, right);
  let rightDoc: Doc;
  if (shouldInline)
    rightDoc = [
      opDoc,
      commentBeforeOperator
        ? indent([line, p(ctx, right)])
        : [text(" "), p(ctx, right)],
    ];
  else if (atStart) {
    let rightContent = p(ctx, right);
    let comment: Doc = [];
    // The right operand's own-line leading comments go above the operator, as prettier shifts them off.
    if (commentBeforeOperator && Array.isArray(rightContent)) {
      const [first = [], ...rest] = rightContent as Doc[];
      comment = first;
      rightContent = rest;
    }
    rightDoc = [line, comment, opDoc, text(" "), rightContent];
  } else rightDoc = [opDoc, line, p(ctx, right)];

  const { parent } = role(node);
  const shouldBreak = hasComment(ctx, left, CF.Trailing | CF.Line);
  const kind = estreeKind(node);
  const shouldGroup =
    shouldBreak ||
    (!(isInsideParenthesis && kind === "LogicalExpression") &&
      estreeKind(parent) !== kind &&
      estreeKind(leftInner) !== kind &&
      estreeKind(unparen(right)) !== kind);
  if (shouldGroup) rightDoc = group(rightDoc, shouldBreak);
  parts.push(
    !atStart || shouldInline || commentBeforeOperator ? text(" ") : [],
    rightDoc,
  );
  // Flat, as prettier's cleanDoc leaves it, so the caller still finds the leftmost operand's group.
  if (isNested && hasComment(ctx, node))
    return flatten(ctx.withComments(node, parts));
  return parts;
}

const isBooleanTypeCoercion = (ctx: JsCtx, n: FormatNode | undefined) =>
  n?.kind === "call_expression" &&
  callArguments(n).length === 1 &&
  callee(n)?.kind === "identifier" &&
  src(ctx, callee(n) as FormatNode) === "Boolean";

const binary: JsRule = (node, ctx) => {
  const { parent, key } = role(node);
  const isInsideParenthesis =
    key !== "body" &&
    (parent?.kind === "if_statement" ||
      parent?.kind === "while_statement" ||
      parent?.kind === "switch_statement" ||
      parent?.kind === "do_statement");
  const parts = printBinaryishExpressions(
    ctx,
    node,
    false,
    isInsideParenthesis,
  );
  if (isInsideParenthesis) return parts;
  if (
    (key === "callee" && isCallOrNew(parent)) ||
    (parent?.kind === "unary_expression" && !hasComment(ctx, node)) ||
    (parent?.kind === "member_expression" && key === "object")
  )
    return group([indent([softline, ...parts]), softline]);
  const grandparent = parent && role(parent).parent;
  const shouldNotIndent =
    isReturnOrThrow(parent) ||
    (parent?.kind === "jsx_expression" &&
      grandparent?.kind === "jsx_attribute") ||
    (key === "body" && parent?.kind === "arrow_function") ||
    (key !== "body" && parent?.kind === "for_statement") ||
    (parent?.kind === "ternary_expression" &&
      !isReturnOrThrow(grandparent) &&
      !isCallOrNew(grandparent)) ||
    parent?.kind === "template_substitution" ||
    (key === "argument" && parent?.kind === "unary_expression") ||
    (key === "arguments" && isBooleanTypeCoercion(ctx, parent));
  const shouldIndentIfInlining =
    parent?.kind === "assignment_expression" ||
    parent?.kind === "augmented_assignment_expression" ||
    parent?.kind === "variable_declarator" ||
    parent?.kind === "public_field_definition" ||
    parent?.kind === "field_definition" ||
    parent?.kind === "pair";
  const leftInner = unparen(field(node, "left") as FormatNode);
  const samePrecedenceSubExpression =
    isBinary(leftInner) && shouldFlatten(operator(node), operator(leftInner));
  if (
    shouldNotIndent ||
    (shouldInlineLogicalExpression(node) && !samePrecedenceSubExpression) ||
    (!shouldInlineLogicalExpression(node) && shouldIndentIfInlining)
  )
    return group(parts);
  if (parts.length === 0) return [];
  const hasJsx = isJsx(unparen(field(node, "right") as FormatNode));
  const firstGroupIndex = parts.findIndex(
    (part) => !Array.isArray(part) && (part as { k: string }).k === "group",
  );
  const headParts = parts.slice(
    0,
    firstGroupIndex === -1 ? 1 : firstGroupIndex + 1,
  );
  const rest = parts.slice(headParts.length, hasJsx ? -1 : undefined);
  const chain = group([...headParts, indent(rest)]);
  if (!hasJsx) return chain;
  return group([chain, indentIfBreak(parts.at(-1) as Doc, chain)]);
};

// --- ternary ---------------------------------------------------------------------------------------------------

const TERNARY = "ternary_expression";

function chainContainsJsx(node: FormatNode): boolean {
  const queue = [node];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i] as FormatNode;
    for (const name of ["condition", "consequence", "alternative"]) {
      const c = field(t, name);
      if (!c) continue;
      const inner = unparen(c);
      if (isJsx(inner)) return true;
      if (inner.kind === TERNARY) queue.push(inner);
    }
  }
  return false;
}

const EXTRA_INDENT_KEYS: Readonly<Record<string, string>> = {
  assignment_expression: "right",
  variable_declarator: "init",
  return_statement: "argument",
  throw_statement: "argument",
  unary_expression: "argument",
  yield_expression: "argument",
  await_expression: "argument",
};

function shouldExtraIndentForConditionalExpression(node: FormatNode): boolean {
  let child = node;
  let parent: FormatNode | undefined;
  let parentKey = "";
  for (;;) {
    const r = role(child);
    const x = r.parent;
    if (!x) return false;
    if (
      (x.kind === "non_null_expression" && r.key === "expression") ||
      (x.kind === "call_expression" && r.key === "callee") ||
      ((x.kind === "member_expression" || x.kind === "subscript_expression") &&
        r.key === "object")
    ) {
      child = x;
      continue;
    }
    if (
      (x.kind === "new_expression" && r.key === "callee") ||
      ((x.kind === "as_expression" || x.kind === "satisfies_expression") &&
        r.key === "expression")
    ) {
      const up = role(x);
      parent = up.parent;
      parentKey = up.key;
      child = x;
    } else {
      parent = x;
      parentKey = r.key;
    }
    break;
  }
  if (child === node || !parent) return false;
  return EXTRA_INDENT_KEYS[parent.kind] === parentKey;
}

const isNil = (ctx: JsCtx, n: FormatNode) =>
  n.kind === "null" ||
  n.kind === "undefined" ||
  (n.kind === "identifier" && src(ctx, n) === "undefined");

const isTestKey = (key: string) =>
  key === "test" || key === "checkType" || key === "extendsType";

/** Prettier's printTernary (ternary-old.js), shared by `a ? b : c` and `A extends B ? C : D`. */
const ternary: JsRule = (node, ctx, args) => {
  if (ctx.options.experimentalTernaries) return printTernary(node, ctx, args);
  const TERNARY = node.kind;
  const isType = TERNARY === "conditional_type";
  const test = field(node, "condition") as FormatNode;
  const consequent = field(node, "consequence") as FormatNode;
  const alternate = field(node, "alternative") as FormatNode;
  const question = t(ctx, anonKid(node, "?"));
  const colon = t(ctx, anonKid(node, ":"));
  const { parent, key } = role(node);
  const isParentTest = parent?.kind === TERNARY && isTestKey(key);
  let forceNoIndent = parent?.kind === TERNARY && !isParentTest;

  let previous = node;
  let current = parent;
  while (current?.kind === TERNARY && !isTestKey(role(previous).key)) {
    previous = current;
    current = role(current).parent;
  }
  const firstNonConditionalParent = current ?? parent;
  const lastConditionalParent = previous;

  const consequentInner = unparen(consequent);
  const alternateInner = unparen(alternate);
  const parts: Doc[] = [];
  let jsxMode = false;
  if (
    (test !== undefined && isJsx(unparen(test))) ||
    isJsx(consequentInner) ||
    isJsx(alternateInner) ||
    chainContainsJsx(lastConditionalParent)
  ) {
    jsxMode = true;
    forceNoIndent = true;
    const wrap = (anchor: FormatNode, doc: Doc): Doc => [
      ifBreak(synthetic(anchor, "(")),
      indent([softline, doc]),
      softline,
      ifBreak(synthetic(anchor, ")")),
    ];
    parts.push(
      text(" "),
      question,
      text(" "),
      isNil(ctx, consequentInner)
        ? p(ctx, consequent)
        : wrap(consequent, p(ctx, consequent)),
      text(" "),
      colon,
      text(" "),
      alternateInner.kind === TERNARY || isNil(ctx, alternateInner)
        ? p(ctx, alternate)
        : wrap(alternate, p(ctx, alternate)),
    );
  } else {
    const printBranch = (n: FormatNode) =>
      ctx.options.useTabs ? indent(p(ctx, n)) : align(2, p(ctx, n));
    const nestedConsequent = consequentInner.kind === TERNARY;
    const part: Doc[] = [
      line,
      question,
      text(" "),
      nestedConsequent ? ifBreak([], synthetic(consequent, "(")) : [],
      printBranch(consequent),
      nestedConsequent ? ifBreak([], synthetic(consequent, ")")) : [],
      line,
      colon,
      text(" "),
      printBranch(alternate),
    ];
    parts.push(
      parent?.kind !== TERNARY || key === "alternate" || isParentTest
        ? part
        : ctx.options.useTabs
          ? part
          : align(Math.max(0, ctx.options.tabWidth - 2), part),
    );
  }
  const maybeGroup = (doc: Doc) =>
    parent === firstNonConditionalParent ? group(doc) : doc;
  const breakClosingParen =
    !jsxMode && parent?.kind === "member_expression" && key === "object";
  const shouldExtraIndent = shouldExtraIndentForConditionalExpression(node);
  const testOnly: Doc = isType
    ? [
        p(ctx, field(node, "left")),
        text(" "),
        t(ctx, anonKid(node, "extends")),
        text(" "),
        p(ctx, field(node, "right")),
      ]
    : p(ctx, test);
  const testDoc =
    parent?.kind === TERNARY && key === "alternate"
      ? align(2, testOnly)
      : testOnly;
  const result = maybeGroup([
    testDoc,
    forceNoIndent ? parts : indent(parts),
    breakClosingParen && !shouldExtraIndent ? softline : [],
  ]);
  return isParentTest || shouldExtraIndent
    ? group([indent([softline, result]), softline])
    : result;
};

// Prettier's isSimpleExpressionByNodeCount: estree's single-node children, where a list (arguments,
// parameters) counts none of its items and a literal or a container counts as one node with nothing inside.
const NODE_COUNT_LISTS = new Set([
  "arguments",
  "formal_parameters",
  "type_arguments",
  "optional_chain",
]);
const NODE_COUNT_LEAVES = new Set([
  "array",
  "object",
  "string",
  "template_string",
  "regex",
  "statement_block",
  "class_body",
]);

function innerNodeCount(n: FormatNode, max: number): number {
  let count = 0;
  for (const c of n.children) {
    if (!c.named || c.kind === "comment" || NODE_COUNT_LISTS.has(c.kind))
      continue;
    const inner = unparen(c);
    count++;
    if (!NODE_COUNT_LEAVES.has(inner.kind))
      count += innerNodeCount(inner, max - count);
    if (count > max) return count;
  }
  return count;
}

const isSimpleExpressionByNodeCount = (n: FormatNode, max: number) =>
  innerNodeCount(unparen(n), max) <= max;

const SAME_LINE_ASSIGNMENT_PARENTS = new Set([
  "assignment_expression",
  "augmented_assignment_expression",
  "variable_declarator",
  "public_field_definition",
  "field_definition",
  "pair",
]);

const wrapInParens = (anchor: FormatNode, doc: Doc): Doc => [
  ifBreak(synthetic(anchor, "(")),
  indent([softline, doc]),
  softline,
  ifBreak(synthetic(anchor, ")")),
];

/** Prettier's printTernary (ternary.js) under experimentalTernaries, for `a ? b : c` and `A extends B ? C : D`. */
function printTernary(node: FormatNode, ctx: JsCtx, args: Args): Doc {
  const kind = node.kind;
  const isConditionalExpression = kind === TERNARY;
  const isTSConditional = !isConditionalExpression;
  const test = field(node, "condition");
  const testNodes = isConditionalExpression
    ? [test]
    : [field(node, "left"), field(node, "right")];
  const consequentNode = field(node, "consequence") as FormatNode;
  const alternateNode = field(node, "alternative") as FormatNode;
  const { parent, key } = role(node);
  const isParentTernary = parent?.kind === kind;
  const isInTest = isParentTernary && isTestKey(key);
  const isInAlternate = isParentTernary && key === "alternate";
  const isConsequentTernary = unparen(consequentNode).kind === kind;
  const isAlternateTernary = unparen(alternateNode).kind === kind;
  const isInChain = isAlternateTernary || isInAlternate;
  const isBigTabs = ctx.options.tabWidth > 2 || ctx.options.useTabs;

  let previous = node;
  let current = parent;
  while (current?.kind === kind && !isTestKey(role(previous).key)) {
    previous = current;
    current = role(current).parent;
  }
  const firstNonConditionalParent = current ?? parent;

  const isOnSameLineAsAssignment =
    args?.assignmentLayout !== undefined &&
    args.assignmentLayout !== "break-after-operator" &&
    parent !== undefined &&
    SAME_LINE_ASSIGNMENT_PARENTS.has(parent.kind);
  const isOnSameLineAsReturn =
    isReturnOrThrow(parent) && !(isConsequentTernary || isAlternateTernary);
  const isInJsx =
    isConditionalExpression &&
    firstNonConditionalParent?.kind === "jsx_expression" &&
    (parent ? role(parent).parent?.kind : undefined) !== "jsx_attribute";

  const shouldExtraIndent = shouldExtraIndentForConditionalExpression(node);
  const breakClosingParen =
    parent?.kind === "member_expression" && key === "object";
  const breakTSClosingParen = isTSConditional && typeNeedsParens(node);
  const fillTab = !isBigTabs
    ? ""
    : ctx.options.useTabs
      ? "\t"
      : " ".repeat(ctx.options.tabWidth - 1);

  const hasMultilineBlockComments = [
    ...testNodes,
    consequentNode,
    alternateNode,
  ].some((n) =>
    getComments(ctx, n).some(
      (c) => isBlockComment(ctx, c) && hasNewlineIn(ctx, c),
    ),
  );
  // A chain breaks as a whole, so only its outermost ternary is grouped.
  const shouldBreak =
    hasMultilineBlockComments || isConsequentTernary || isAlternateTernary;

  // `const result = foo != null ? foo : (\n  some + long + expression\n);` keeps a short consequent up.
  const consequentInner = unparen(consequentNode);
  const tryToParenthesizeAlternate =
    !isInChain &&
    !isParentTernary &&
    !isTSConditional &&
    (isInJsx
      ? consequentInner.kind === "null"
      : isLoneShortArgument(ctx, consequentNode) &&
        isSimpleExpressionByNodeCount(test as FormatNode, 3));

  const shouldGroupTestAndConsequent =
    isInChain ||
    isInAlternate ||
    (isTSConditional && !isParentTernary) ||
    (isParentTernary &&
      isConditionalExpression &&
      isSimpleExpressionByNodeCount(test as FormatNode, 1)) ||
    tryToParenthesizeAlternate;

  const alternateComments: Doc[] = [];
  if (test && ctx.dangling(test).length > 0)
    alternateComments.push(join(hardline, ctx.dangling(test)));
  if (ctx.dangling(node).length > 0)
    alternateComments.push(join(hardline, ctx.dangling(node)));

  const question = t(ctx, anonKid(node, "?"));
  const colon = t(ctx, anonKid(node, ":"));
  let printedTest: Doc;
  if (test) {
    printedTest = [
      wrapInParens(test, p(ctx, test)),
      unparen(test).kind === TERNARY ? breakParent : [],
    ];
  } else {
    const ext = field(node, "right") as FormatNode;
    printedTest = [
      p(ctx, field(node, "left")),
      text(" "),
      t(ctx, anonKid(node, "extends")),
      text(" "),
      ext.kind === kind || (ext.kind === "object_type" && mappedClauseOf(ext))
        ? p(ctx, ext)
        : group(wrapInParens(ext, p(ctx, ext))),
    ];
  }
  const testGroup = group([printedTest, text(" "), question]);

  const consequent = indent([
    isConsequentTernary ||
    (isInJsx && (isJsx(consequentInner) || isParentTernary || isInChain))
      ? hardline
      : line,
    p(ctx, consequentNode),
  ]);
  // Unless in a chain, a broken test breaks the consequent too.
  const testAndConsequentGroup = shouldGroupTestAndConsequent
    ? group([
        testGroup,
        isInChain
          ? consequent
          : ifBreak(consequent, group(consequent), testGroup),
      ])
    : undefined;

  const printedAlternate = p(ctx, alternateNode);
  const printedAlternateWithParens =
    tryToParenthesizeAlternate && testAndConsequentGroup
      ? ifBreak(
          printedAlternate,
          dedent(wrapInParens(alternateNode, printedAlternate)),
          testAndConsequentGroup,
        )
      : printedAlternate;

  const parts: Doc[] = [
    testAndConsequentGroup ?? [testGroup, consequent],
    alternateComments.length > 0
      ? [indent([hardline, alternateComments]), hardline]
      : isAlternateTernary
        ? hardline
        : tryToParenthesizeAlternate
          ? ifBreak(line, text(" "), testAndConsequentGroup)
          : line,
    colon,
    isAlternateTernary || !isBigTabs
      ? text(" ")
      : shouldGroupTestAndConsequent
        ? ifBreak(
            text(fillTab),
            ifBreak(
              text(isInChain || tryToParenthesizeAlternate ? " " : fillTab),
              text(" "),
            ),
            testAndConsequentGroup,
          )
        : ifBreak(text(fillTab), text(" ")),
    isAlternateTernary
      ? printedAlternateWithParens
      : group([
          indent(printedAlternateWithParens),
          isInJsx && !tryToParenthesizeAlternate ? softline : [],
        ]),
    breakClosingParen && !shouldExtraIndent ? softline : [],
    shouldBreak ? breakParent : [],
  ];

  // A one-line ternary bumped past `=` stays one line there.
  if (isOnSameLineAsAssignment && !shouldBreak)
    return group(indent([softline, group(parts)]));
  if (isOnSameLineAsAssignment || isOnSameLineAsReturn)
    return group(indent(parts));
  if (shouldExtraIndent || (isTSConditional && isInTest))
    return group([
      indent([softline, parts]),
      breakTSClosingParen ? softline : [],
    ]);
  return parent === firstNonConditionalParent ? group(parts) : parts;
}

// --- the rest --------------------------------------------------------------------------------------------------

const unary: JsRule = (node, ctx) => {
  const op = field(node, "operator");
  const arg = field(node, "argument") as FormatNode;
  const opText = op ? src(ctx, op) : "";
  const argDoc = p(ctx, arg);
  return [
    t(ctx, op),
    /[a-z]$/.test(opText) ? text(" ") : [],
    hasComment(ctx, arg)
      ? group([
          synthetic(arg, "("),
          indent([softline, argDoc]),
          softline,
          synthetic(arg, ")"),
        ])
      : argDoc,
  ];
};

const update: JsRule = (node, ctx) =>
  node.children.map((c) => (c.named ? p(ctx, c) : t(ctx, c)));

const awaitExpression: JsRule = (node, ctx) => {
  const kw = t(ctx, anonKid(node, "await"));
  const arg = items(node)[0];
  if (!arg) return kw;
  let parts: Doc = [kw, text(" "), p(ctx, arg)];
  const { parent, key } = role(node);
  if (
    (parent?.kind === "call_expression" && key === "callee") ||
    ((parent?.kind === "member_expression" ||
      parent?.kind === "subscript_expression") &&
      key === "object")
  ) {
    parts = [indent([softline, parts]), softline];
    let ancestor: FormatNode | undefined = parent;
    while (
      ancestor &&
      ancestor.kind !== "await_expression" &&
      ancestor.kind !== "statement_block"
    )
      ancestor = ancestor.parent;
    if (
      ancestor?.kind !== "await_expression" ||
      !startsWith(items(ancestor)[0], node)
    )
      return group(parts);
  }
  return parts;
};

/** Whether `target` is the leftmost node of expression `n` (prettier's startsWithNoLookaheadToken). */
function startsWith(n: FormatNode | undefined, target: FormatNode): boolean {
  for (let x = n; x; ) {
    if (x === target) return true;
    switch (x.kind) {
      case "call_expression":
        x = callee(x);
        break;
      case "member_expression":
      case "subscript_expression":
        x = field(x, "object");
        break;
      case "binary_expression":
      case "assignment_expression":
        x = field(x, "left");
        break;
      case "ternary_expression":
        x = field(x, "condition");
        break;
      case "parenthesized_expression":
      case "non_null_expression":
      case "sequence_expression":
      case "as_expression":
      case "satisfies_expression":
        x = items(x)[0];
        break;
      default:
        return false;
    }
  }
  return false;
}

const yieldExpression: JsRule = (node, ctx) => {
  const arg = items(node)[0];
  return [
    t(ctx, anonKid(node, "yield")),
    t(ctx, anonKid(node, "*")),
    arg ? [text(" "), p(ctx, arg)] : [],
  ];
};

const sequence: JsRule = (node, ctx) => {
  const expressions = items(node);
  const commas = node.children.filter((c) => !c.named && c.kind === ",");
  const { parent, key } = role(node);
  if (
    parent?.kind === "expression_statement" ||
    parent?.kind === "for_statement"
  ) {
    const parts: Doc[] = [];
    expressions.forEach((e, i) => {
      if (i === 0) parts.push(p(ctx, e));
      else parts.push(t(ctx, commas[i - 1]), indent([line, p(ctx, e)]));
    });
    return group(parts);
  }
  const parts: Doc[] = [];
  expressions.forEach((e, i) => {
    if (i > 0) parts.push(t(ctx, commas[i - 1]), line);
    parts.push(p(ctx, e));
  });
  const shouldIndent =
    (key === "argument" && isReturnOrThrow(parent) && needsParens(node, ctx)) ||
    (key === "body" && parent?.kind === "arrow_function");
  if (shouldIndent)
    return group(ifBreak([indent([softline, parts]), softline], parts));
  return group(parts);
};

const assignment: JsRule = (node, ctx, _args?: Args) => {
  const op = field(node, "operator") ?? anonKid(node, "=");
  return printAssignment(
    ctx,
    node,
    p(ctx, field(node, "left")),
    [text(" "), t(ctx, op)],
    field(node, "right"),
  );
};

export const operatorRules: Record<string, JsRule> = {
  binary_expression: binary,
  ternary_expression: ternary,
  conditional_type: ternary,
  unary_expression: unary,
  update_expression: update,
  await_expression: awaitExpression,
  yield_expression: yieldExpression,
  sequence_expression: sequence,
  assignment_expression: assignment,
  augmented_assignment_expression: assignment,
};
