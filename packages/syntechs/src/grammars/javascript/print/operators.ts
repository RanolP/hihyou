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
  isDocs,
  join,
  kindOf,
  line,
  softline,
  synthetic,
  text,
} from "../../../fmt/doc.js";
import {
  isLoneShortArgument,
  logicalRight,
  printAssignment,
  shouldInlineLogicalExpression,
} from "./assignment.js";
import { needsParens, role, shouldFlatten } from "./parens.js";
import { mappedClauseOf, typeNeedsParens } from "./types.js";
import {
  type Args,
  anon,
  CF,
  callArguments,
  callee,
  children,
  field,
  fieldName,
  first,
  getComments,
  type HasTree,
  hasComment,
  hasLeadingOwnLineComment,
  hasNewlineIn,
  isBlockComment,
  isJsx,
  isLogical,
  items,
  type JsCtx,
  type JsRule,
  kind,
  named,
  operator,
  p,
  parent as parentOf,
  src,
  t,
  unparen,
} from "./util.js";

const isBinary = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "binary_expression";
/** Prettier's node type, where `&&`, `||` and `??` make a LogicalExpression. */
const estreeKind = (x: HasTree, n: number | undefined) =>
  isBinary(x, n)
    ? isLogical(x, n)
      ? "LogicalExpression"
      : "BinaryExpression"
    : kind(x, n);
const isCallOrNew = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return k === "call_expression" || k === "new_expression";
};
const isReturnOrThrow = (x: HasTree, n: number | undefined) => {
  const k = kind(x, n);
  return k === "return_statement" || k === "throw_statement";
};

const flatten = (d: Doc): Doc[] =>
  Array.isArray(d) ? d.flatMap(flatten) : [d as Doc];

// --- binaryish -------------------------------------------------------------------------------------------------

/**
 * Prettier's parser rebalances `a || (b || c)` into `(a || b) || c`, so a logical chain whose right operand
 * repeats its operator prints as one flat chain. Undefined when `node` is no such chain, or when a comment
 * sits on a node the rebalance would drop.
 */
function printRebalancedChain(ctx: JsCtx, node: number): Doc[] | undefined {
  const op = operator(ctx, node);
  const right = unparen(ctx, field(ctx, node, "right") as number);
  if (
    !isLogical(ctx, node) ||
    !isLogical(ctx, right) ||
    operator(ctx, right) !== op
  )
    return undefined;
  const operands: number[] = [];
  const ops: number[] = [];
  let clean = true;
  const walk = (c: number, top = false) => {
    const inner = unparen(ctx, c);
    if (!top && !(isLogical(ctx, inner) && operator(ctx, inner) === op)) {
      operands.push(c);
      return;
    }
    if (!top && (hasComment(ctx, c) || hasComment(ctx, inner))) clean = false;
    walk(field(ctx, inner, "left") as number);
    ops.push(field(ctx, inner, "operator") as number);
    walk(field(ctx, inner, "right") as number);
  };
  walk(node, true);
  if (!clean || operands.slice(1).some((o) => hasComment(ctx, o, CF.Leading)))
    return undefined;
  const atStart = ctx.options.experimentalOperatorPosition === "start";
  const [head, ...rest] = operands as [number, ...number[]];
  const parts: Doc[] = [group(p(ctx, head))];
  rest.forEach((operand, i) => {
    const opDoc = t(ctx, ops[i]);
    const inner = unparen(ctx, operand);
    const innerKind = kind(ctx, inner);
    const inline =
      ((innerKind === "object" || innerKind === "array") &&
        items(ctx, inner).length > 0) ||
      innerKind === "jsx_element" ||
      innerKind === "jsx_self_closing_element";
    let rightDoc: Doc = inline
      ? [opDoc, text(" "), p(ctx, operand)]
      : atStart
        ? [line, opDoc, text(" "), p(ctx, operand)]
        : [opDoc, line, p(ctx, operand)];
    if (i === 0 && hasComment(ctx, head, CF.Trailing | CF.Line))
      rightDoc = group(rightDoc, true);
    parts.push(!atStart || inline ? text(" ") : [], rightDoc);
  });
  return parts;
}

function printBinaryishExpressions(
  ctx: JsCtx,
  node: number,
  isNested: boolean,
  isInsideParenthesis: boolean,
): Doc[] {
  const left = field(ctx, node, "left") as number;
  const right = field(ctx, node, "right") as number;
  const leftInner = unparen(ctx, left);
  const op = operator(ctx, node);
  const rebalanced = printRebalancedChain(ctx, node);
  if (rebalanced) {
    if (isNested && hasComment(ctx, node))
      return flatten(ctx.withComments(node, rebalanced));
    return rebalanced;
  }
  let parts: Doc[] = [];
  if (isBinary(ctx, leftInner) && shouldFlatten(op, operator(ctx, leftInner))) {
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

  const shouldInline = shouldInlineLogicalExpression(ctx, node);
  const opDoc = t(ctx, field(ctx, node, "operator"));
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

  const { parent } = role(ctx, node);
  const shouldBreak = hasComment(ctx, left, CF.Trailing | CF.Line);
  const estree = estreeKind(ctx, node);
  const shouldGroup =
    shouldBreak ||
    (!(isInsideParenthesis && estree === "LogicalExpression") &&
      estreeKind(ctx, parent) !== estree &&
      estreeKind(ctx, leftInner) !== estree &&
      estreeKind(ctx, unparen(ctx, right)) !== estree);
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

const isBooleanTypeCoercion = (ctx: JsCtx, n: number | undefined) =>
  n !== undefined &&
  kind(ctx, n) === "call_expression" &&
  callArguments(ctx, n).length === 1 &&
  kind(ctx, callee(ctx, n)) === "identifier" &&
  src(ctx, callee(ctx, n) as number) === "Boolean";

const binary: JsRule = (node, ctx) => {
  const { parent, key } = role(ctx, node);
  const parentKind = kind(ctx, parent);
  const isInsideParenthesis =
    key !== "body" &&
    (parentKind === "if_statement" ||
      parentKind === "while_statement" ||
      parentKind === "switch_statement" ||
      parentKind === "do_statement");
  const parts = printBinaryishExpressions(
    ctx,
    node,
    false,
    isInsideParenthesis,
  );
  if (isInsideParenthesis) return parts;
  if (
    (key === "callee" && isCallOrNew(ctx, parent)) ||
    (parentKind === "unary_expression" && !hasComment(ctx, node)) ||
    (parentKind === "member_expression" && key === "object")
  )
    return group([indent([softline, ...parts]), softline]);
  const grandparent =
    parent !== undefined ? role(ctx, parent).parent : undefined;
  const shouldNotIndent =
    isReturnOrThrow(ctx, parent) ||
    (parentKind === "jsx_expression" &&
      kind(ctx, grandparent) === "jsx_attribute") ||
    (key === "body" && parentKind === "arrow_function") ||
    (key !== "body" && parentKind === "for_statement") ||
    (parentKind === "ternary_expression" &&
      !isReturnOrThrow(ctx, grandparent) &&
      !isCallOrNew(ctx, grandparent)) ||
    parentKind === "template_substitution" ||
    (key === "argument" && parentKind === "unary_expression") ||
    (key === "arguments" && isBooleanTypeCoercion(ctx, parent));
  const shouldIndentIfInlining =
    parentKind === "assignment_expression" ||
    parentKind === "augmented_assignment_expression" ||
    parentKind === "variable_declarator" ||
    parentKind === "public_field_definition" ||
    parentKind === "field_definition" ||
    parentKind === "pair";
  const leftInner = unparen(ctx, field(ctx, node, "left") as number);
  const right = logicalRight(ctx, node) as number;
  const samePrecedenceSubExpression =
    (isBinary(ctx, leftInner) &&
      shouldFlatten(operator(ctx, node), operator(ctx, leftInner))) ||
    right !== field(ctx, node, "right");
  if (
    shouldNotIndent ||
    (shouldInlineLogicalExpression(ctx, node) &&
      !samePrecedenceSubExpression) ||
    (!shouldInlineLogicalExpression(ctx, node) && shouldIndentIfInlining)
  )
    return group(parts);
  if (parts.length === 0) return [];
  const hasJsx = isJsx(ctx, unparen(ctx, right));
  const firstGroupIndex = parts.findIndex(
    (part) => !isDocs(part) && kindOf(part) === "group",
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

function chainContainsJsx(x: HasTree, node: number): boolean {
  const queue = [node];
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i] as number;
    for (const name of ["condition", "consequence", "alternative"]) {
      const c = field(x, t, name);
      if (c === undefined) continue;
      const inner = unparen(x, c);
      if (isJsx(x, inner)) return true;
      if (kind(x, inner) === TERNARY) queue.push(inner);
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

function shouldExtraIndentForConditionalExpression(
  ctx: HasTree,
  node: number,
): boolean {
  let child = node;
  let parent: number | undefined;
  let parentKey = "";
  for (;;) {
    const r = role(ctx, child);
    const x = r.parent;
    if (x === undefined) return false;
    const xKind = kind(ctx, x);
    if (
      (xKind === "non_null_expression" && r.key === "expression") ||
      (xKind === "call_expression" && r.key === "callee") ||
      ((xKind === "member_expression" || xKind === "subscript_expression") &&
        r.key === "object")
    ) {
      child = x;
      continue;
    }
    if (
      (xKind === "new_expression" && r.key === "callee") ||
      ((xKind === "as_expression" || xKind === "satisfies_expression") &&
        r.key === "expression")
    ) {
      const up = role(ctx, x);
      parent = up.parent;
      parentKey = up.key;
      child = x;
    } else {
      parent = x;
      parentKey = r.key;
    }
    break;
  }
  if (child === node || parent === undefined) return false;
  return EXTRA_INDENT_KEYS[kind(ctx, parent)] === parentKey;
}

const isNil = (ctx: JsCtx, n: number) => {
  const k = kind(ctx, n);
  return (
    k === "null" ||
    k === "undefined" ||
    (k === "identifier" && src(ctx, n) === "undefined")
  );
};

// A conditional type's parent and key look through the source's parentheses, as role does for expressions.
const TYPE_KEYS: Readonly<Record<string, string>> = {
  left: "checkType",
  right: "extendsType",
  consequence: "consequent",
  alternative: "alternate",
};
function ternaryRole(
  x: HasTree,
  n: number,
): {
  parent: number | undefined;
  key: string;
} {
  if (kind(x, n) !== "conditional_type") return role(x, n);
  let top = n;
  let parent = parentOf(x, top);
  while (parent !== undefined && kind(x, parent) === "parenthesized_type") {
    top = parent;
    parent = parentOf(x, top);
  }
  const key = fieldName(x, top) ?? "";
  return {
    parent,
    key: kind(x, parent) === "conditional_type" ? (TYPE_KEYS[key] ?? key) : key,
  };
}
const bare = (h: HasTree, n: number): number => {
  let x = unparen(h, n);
  while (kind(h, x) === "parenthesized_type") x = first(h, x) ?? x;
  return x;
};

const isTestKey = (key: string) =>
  key === "test" || key === "checkType" || key === "extendsType";

/** Prettier's printTernary (ternary-old.js), shared by `a ? b : c` and `A extends B ? C : D`. */
const ternary: JsRule = (node, ctx, args) => {
  if (ctx.options.experimentalTernaries) return printTernary(node, ctx, args);
  const TERNARY = kind(ctx, node);
  const isType = TERNARY === "conditional_type";
  const test = field(ctx, node, "condition") as number;
  const consequent = field(ctx, node, "consequence") as number;
  const alternate = field(ctx, node, "alternative") as number;
  const question = t(ctx, anon(ctx, node, "?"));
  const colon = t(ctx, anon(ctx, node, ":"));
  const { parent, key } = ternaryRole(ctx, node);
  const parentKind = kind(ctx, parent);
  const isParentTest = parentKind === TERNARY && isTestKey(key);
  let forceNoIndent = parentKind === TERNARY && !isParentTest;

  let previous = node;
  let current = parent;
  while (
    current !== undefined &&
    kind(ctx, current) === TERNARY &&
    !isTestKey(ternaryRole(ctx, previous).key)
  ) {
    previous = current;
    current = ternaryRole(ctx, current).parent;
  }
  const firstNonConditionalParent = current ?? parent;
  const lastConditionalParent = previous;

  const consequentInner = bare(ctx, consequent);
  const alternateInner = bare(ctx, alternate);
  const parts: Doc[] = [];
  let jsxMode = false;
  if (
    (test !== undefined && isJsx(ctx, unparen(ctx, test))) ||
    isJsx(ctx, consequentInner) ||
    isJsx(ctx, alternateInner) ||
    chainContainsJsx(ctx, lastConditionalParent)
  ) {
    jsxMode = true;
    forceNoIndent = true;
    const wrap = (anchor: number, doc: Doc): Doc => [
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
      kind(ctx, alternateInner) === TERNARY || isNil(ctx, alternateInner)
        ? p(ctx, alternate)
        : wrap(alternate, p(ctx, alternate)),
    );
  } else {
    const printBranch = (n: number) =>
      ctx.options.useTabs ? indent(p(ctx, n)) : align(2, p(ctx, n));
    const nestedConsequent = kind(ctx, consequentInner) === TERNARY;
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
      parentKind !== TERNARY || key === "alternate" || isParentTest
        ? part
        : ctx.options.useTabs
          ? part
          : align(Math.max(0, ctx.options.tabWidth - 2), part),
    );
  }
  const maybeGroup = (doc: Doc) =>
    parent === firstNonConditionalParent ? group(doc) : doc;
  const breakClosingParen =
    !jsxMode && parentKind === "member_expression" && key === "object";
  const shouldExtraIndent = shouldExtraIndentForConditionalExpression(
    ctx,
    node,
  );
  const testOnly: Doc = isType
    ? [
        p(ctx, field(ctx, node, "left")),
        text(" "),
        t(ctx, anon(ctx, node, "extends")),
        text(" "),
        p(ctx, field(ctx, node, "right")),
      ]
    : p(ctx, test);
  const testDoc =
    parentKind === TERNARY && key === "alternate"
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

function innerNodeCount(x: HasTree, n: number, max: number): number {
  let count = 0;
  for (const c of children(x, n)) {
    if (
      !named(x, c) ||
      kind(x, c) === "comment" ||
      NODE_COUNT_LISTS.has(kind(x, c))
    )
      continue;
    const inner = unparen(x, c);
    count++;
    if (!NODE_COUNT_LEAVES.has(kind(x, inner)))
      count += innerNodeCount(x, inner, max - count);
    if (count > max) return count;
  }
  return count;
}

const isSimpleExpressionByNodeCount = (x: HasTree, n: number, max: number) =>
  innerNodeCount(x, unparen(x, n), max) <= max;

const SAME_LINE_ASSIGNMENT_PARENTS = new Set([
  "assignment_expression",
  "augmented_assignment_expression",
  "variable_declarator",
  "public_field_definition",
  "field_definition",
  "pair",
]);

const wrapInParens = (anchor: number, doc: Doc): Doc => [
  ifBreak(synthetic(anchor, "(")),
  indent([softline, doc]),
  softline,
  ifBreak(synthetic(anchor, ")")),
];

/** Prettier's printTernary (ternary.js) under experimentalTernaries, for `a ? b : c` and `A extends B ? C : D`. */
function printTernary(node: number, ctx: JsCtx, args: Args): Doc {
  const nodeKind = kind(ctx, node);
  const isConditionalExpression = nodeKind === TERNARY;
  const isTSConditional = !isConditionalExpression;
  const test = field(ctx, node, "condition");
  const testNodes = isConditionalExpression
    ? [test]
    : [field(ctx, node, "left"), field(ctx, node, "right")];
  const consequentNode = field(ctx, node, "consequence") as number;
  const alternateNode = field(ctx, node, "alternative") as number;
  const { parent, key } = ternaryRole(ctx, node);
  const isParentTernary = kind(ctx, parent) === nodeKind;
  const isInTest = isParentTernary && isTestKey(key);
  const isInAlternate = isParentTernary && key === "alternate";
  const isConsequentTernary = kind(ctx, bare(ctx, consequentNode)) === nodeKind;
  const isAlternateTernary = kind(ctx, bare(ctx, alternateNode)) === nodeKind;
  const isInChain = isAlternateTernary || isInAlternate;
  const isBigTabs = ctx.options.tabWidth > 2 || ctx.options.useTabs;

  let previous = node;
  let current = parent;
  while (
    current !== undefined &&
    kind(ctx, current) === nodeKind &&
    !isTestKey(ternaryRole(ctx, previous).key)
  ) {
    previous = current;
    current = ternaryRole(ctx, current).parent;
  }
  const firstNonConditionalParent = current ?? parent;

  const isOnSameLineAsAssignment =
    args?.assignmentLayout !== undefined &&
    args.assignmentLayout !== "break-after-operator" &&
    parent !== undefined &&
    SAME_LINE_ASSIGNMENT_PARENTS.has(kind(ctx, parent));
  const isOnSameLineAsReturn =
    isReturnOrThrow(ctx, parent) &&
    !(isConsequentTernary || isAlternateTernary);
  const isInJsx =
    isConditionalExpression &&
    kind(ctx, firstNonConditionalParent) === "jsx_expression" &&
    kind(ctx, parent !== undefined ? role(ctx, parent).parent : undefined) !==
      "jsx_attribute";

  const shouldExtraIndent = shouldExtraIndentForConditionalExpression(
    ctx,
    node,
  );
  const breakClosingParen =
    kind(ctx, parent) === "member_expression" && key === "object";
  const breakTSClosingParen = isTSConditional && typeNeedsParens(ctx, node);
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
  const consequentInner = unparen(ctx, consequentNode);
  const tryToParenthesizeAlternate =
    !isInChain &&
    !isParentTernary &&
    !isTSConditional &&
    (isInJsx
      ? kind(ctx, consequentInner) === "null"
      : isLoneShortArgument(ctx, consequentNode) &&
        isSimpleExpressionByNodeCount(ctx, test as number, 3));

  const shouldGroupTestAndConsequent =
    isInChain ||
    isInAlternate ||
    (isTSConditional && !isParentTernary) ||
    (isParentTernary &&
      isConditionalExpression &&
      isSimpleExpressionByNodeCount(ctx, test as number, 1)) ||
    tryToParenthesizeAlternate;

  const alternateComments: Doc[] = [];
  if (test !== undefined && ctx.dangling(test).length > 0)
    alternateComments.push(join(hardline, ctx.dangling(test)));
  if (ctx.dangling(node).length > 0)
    alternateComments.push(join(hardline, ctx.dangling(node)));

  const question = t(ctx, anon(ctx, node, "?"));
  const colon = t(ctx, anon(ctx, node, ":"));
  let printedTest: Doc;
  if (test !== undefined) {
    printedTest = [
      wrapInParens(test, p(ctx, test)),
      kind(ctx, unparen(ctx, test)) === TERNARY ? breakParent : [],
    ];
  } else {
    const ext = field(ctx, node, "right") as number;
    printedTest = [
      p(ctx, field(ctx, node, "left")),
      text(" "),
      t(ctx, anon(ctx, node, "extends")),
      text(" "),
      kind(ctx, bare(ctx, ext)) === nodeKind ||
      (kind(ctx, bare(ctx, ext)) === "object_type" &&
        mappedClauseOf(ctx, bare(ctx, ext)) !== undefined)
        ? p(ctx, ext)
        : group(wrapInParens(ext, p(ctx, ext))),
    ];
  }
  const testGroup = group([printedTest, text(" "), question]);

  const consequent = indent([
    isConsequentTernary ||
    (isInJsx && (isJsx(ctx, consequentInner) || isParentTernary || isInChain))
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
    tryToParenthesizeAlternate && testAndConsequentGroup !== undefined
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
  const op = field(ctx, node, "operator");
  const arg = field(ctx, node, "argument") as number;
  const opText = op !== undefined ? src(ctx, op) : "";
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
  children(ctx, node).map((c) => (named(ctx, c) ? p(ctx, c) : t(ctx, c)));

const awaitExpression: JsRule = (node, ctx) => {
  const kw = t(ctx, anon(ctx, node, "await"));
  const arg = items(ctx, node)[0];
  if (arg === undefined) return kw;
  let parts: Doc = [kw, text(" "), p(ctx, arg)];
  const { parent, key } = role(ctx, node);
  const parentKind = kind(ctx, parent);
  if (
    (parentKind === "call_expression" && key === "callee") ||
    ((parentKind === "member_expression" ||
      parentKind === "subscript_expression") &&
      key === "object")
  ) {
    parts = [indent([softline, parts]), softline];
    let ancestor: number | undefined = parent;
    while (
      ancestor !== undefined &&
      kind(ctx, ancestor) !== "await_expression" &&
      kind(ctx, ancestor) !== "statement_block"
    )
      ancestor = parentOf(ctx, ancestor);
    if (
      ancestor === undefined ||
      kind(ctx, ancestor) !== "await_expression" ||
      !startsWith(ctx, items(ctx, ancestor)[0], node)
    )
      return group(parts);
  }
  return parts;
};

/** Whether `target` is the leftmost node of expression `n` (prettier's startsWithNoLookaheadToken). */
function startsWith(
  ctx: HasTree,
  n: number | undefined,
  target: number,
): boolean {
  for (let x = n; x !== undefined;) {
    if (x === target) return true;
    switch (kind(ctx, x)) {
      case "call_expression":
        x = callee(ctx, x);
        break;
      case "member_expression":
      case "subscript_expression":
        x = field(ctx, x, "object");
        break;
      case "binary_expression":
      case "assignment_expression":
        x = field(ctx, x, "left");
        break;
      case "ternary_expression":
        x = field(ctx, x, "condition");
        break;
      case "parenthesized_expression":
      case "non_null_expression":
      case "sequence_expression":
      case "as_expression":
      case "satisfies_expression":
        x = items(ctx, x)[0];
        break;
      default:
        return false;
    }
  }
  return false;
}

const yieldExpression: JsRule = (node, ctx) => {
  const arg = items(ctx, node)[0];
  return [
    t(ctx, anon(ctx, node, "yield")),
    t(ctx, anon(ctx, node, "*")),
    arg !== undefined ? [text(" "), p(ctx, arg)] : [],
  ];
};

const sequence: JsRule = (node, ctx) => {
  const expressions = items(ctx, node);
  const commas = children(ctx, node).filter(
    (c) => !named(ctx, c) && kind(ctx, c) === ",",
  );
  const { parent, key } = role(ctx, node);
  const parentKind = kind(ctx, parent);
  if (parentKind === "expression_statement" || parentKind === "for_statement") {
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
    (key === "argument" &&
      isReturnOrThrow(ctx, parent) &&
      needsParens(node, ctx)) ||
    (key === "body" && parentKind === "arrow_function");
  if (shouldIndent)
    return group(ifBreak([indent([softline, parts]), softline], parts));
  return group(parts);
};

const assignment: JsRule = (node, ctx, _args?: Args) => {
  const op = field(ctx, node, "operator") ?? anon(ctx, node, "=");
  return printAssignment(
    ctx,
    node,
    p(ctx, field(ctx, node, "left")),
    [text(" "), t(ctx, op)],
    field(ctx, node, "right"),
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
