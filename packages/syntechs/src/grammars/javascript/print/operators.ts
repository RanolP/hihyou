// Prettier's expression printers for operators: binaryish.js, ternary-old.js, sequence-expression.js,
// await-expression.js, assignment expressions and the unary, update and yield cases of estree.js. The update and
// yield cases are structure in format.ts; the ternary, unary, await and sequence layouts are its customs, written
// against sink.ts.

import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import {
  BROKEN,
  capture,
  close,
  commentsOf,
  GROUP,
  IF_BROKEN,
  IF_FLAT,
  INDENT,
  jsCtx,
  type JsStreamCtx,
  open,
  openAlign,
  openIndentIfBreak,
  type Part,
  place,
  SOFT,
  sBreakParent,
  sHardline,
  sLine,
  sText,
  sToken,
} from "../sink.js";
import {
  isLoneShortArgument,
  logicalRight,
  sPrintAssignment,
  shouldInlineLogicalExpression,
} from "./assignment.js";
import { needsParens, role, shouldFlatten } from "./parens.js";
import { mappedClauseOf, typeNeedsParens } from "./types.js";
import {
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
  hasCommentThroughParens,
  hasLeadingOwnLineComment,
  hasNewlineIn,
  isBlockComment,
  isJsx,
  isLogical,
  isOptional,
  type JsOptions,
  items,
  type JsCtx,
  kind,
  named,
  operator,
  parent as parentOf,
  src,
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
// --- binaryish -------------------------------------------------------------------------------------------------

/** One element of prettier's flat binaryish parts list, written when run. */
type Emit = () => void;
/** A chain's parts; `head` indexes its leftmost operand's group, which the caller keeps out of the indent. */
interface Binaryish {
  parts: Emit[];
  head: number;
}

/**
 * `chain` inside `node`'s own comments, which prettier prints around the flat parts (a chain printed inline, not
 * through ctx.print).
 */
function withOwnComments(
  ctx: JsStreamCtx,
  node: number,
  chain: Binaryish,
): Binaryish {
  const comments = commentsOf(ctx, node);
  if (comments === undefined) return chain;
  const [leading, trailing] = comments;
  return {
    parts: [leading, ...chain.parts, trailing],
    head: chain.head + 1,
  };
}

/**
 * Prettier's parser rebalances `a || (b || c)` into `(a || b) || c`, so a logical chain whose right operand
 * repeats its operator prints as one flat chain. A dropped node's leading comments, `a &&⏎// c⏎(b && d)`, lead
 * the first operand after it, as prettier attaches them to the rebalanced tree. Undefined when `node` is no such
 * chain, or when another comment sits on a node the rebalance would drop.
 */
function printRebalancedChain(
  ctx: JsStreamCtx,
  node: number,
): Binaryish | undefined {
  const js = ctx.js;
  const op = operator(js, node);
  const right = unparen(js, field(js, node, "right") as number);
  if (!isLogical(js, node) || !isLogical(js, right) || operator(js, right) !== op)
    return undefined;
  const atStart = js.options.experimentalOperatorPosition === "start";
  const operands: number[] = [];
  const ops: number[] = [];
  // The dropped nodes whose leading comments each operand prints before itself.
  const lifted = new Map<number, number[]>();
  let pending: number[] = [];
  let clean = true;
  const walk = (c: number, top = false) => {
    const inner = unparen(js, c);
    if (!top && !(isLogical(js, inner) && operator(js, inner) === op)) {
      if (pending.length > 0) lifted.set(operands.length, pending);
      pending = [];
      operands.push(c);
      return;
    }
    if (!top)
      for (const dropped of new Set([c, inner])) {
        if (!hasComment(js, dropped)) continue;
        if (atStart || operands.length === 0 || hasComment(js, dropped, CF.Trailing | CF.Dangling))
          clean = false;
        else pending.push(dropped);
      }
    walk(field(js, inner, "left") as number);
    ops.push(field(js, inner, "operator") as number);
    walk(field(js, inner, "right") as number);
  };
  walk(node, true);
  if (!clean || operands.slice(1).some((o) => hasComment(js, o, CF.Leading)))
    return undefined;
  const [head, ...rest] = operands as [number, ...number[]];
  const parts: Emit[] = [() => within(GROUP, () => ctx.print(head))];
  rest.forEach((operand, i) => {
    const opTok = ops[i];
    const inner = unparen(js, operand);
    const innerKind = kind(js, inner);
    const inline =
      ((innerKind === "object" || innerKind === "array") &&
        items(js, inner).length > 0) ||
      innerKind === "jsx_element" ||
      innerKind === "jsx_self_closing_element";
    const rightDoc = () => {
      if (inline) {
        tok(js, opTok);
        sText(" ");
      } else if (atStart) {
        sLine(0);
        tok(js, opTok);
        sText(" ");
      } else {
        tok(js, opTok);
        sLine(0);
      }
      for (const dropped of lifted.get(i + 1) ?? []) commentsOf(ctx, dropped)?.[0]();
      ctx.print(operand);
    };
    const broken = i === 0 && hasComment(js, head, CF.Trailing | CF.Line);
    if (!atStart || inline) parts.push(() => sText(" "));
    parts.push(
      broken ? () => within(GROUP, rightDoc, -1, BROKEN) : rightDoc,
    );
  });
  return { parts, head: 0 };
}

function printBinaryishExpressions(
  ctx: JsStreamCtx,
  node: number,
  isNested: boolean,
  isInsideParenthesis: boolean,
): Binaryish {
  const js = ctx.js;
  const left = field(js, node, "left") as number;
  const right = field(js, node, "right") as number;
  const leftInner = unparen(js, left);
  const op = operator(js, node);
  const rebalanced = printRebalancedChain(ctx, node);
  if (rebalanced)
    return isNested && hasComment(js, node)
      ? withOwnComments(ctx, node, rebalanced)
      : rebalanced;
  let chain: Binaryish;
  if (isBinary(js, leftInner) && shouldFlatten(op, operator(js, leftInner))) {
    chain = printBinaryishExpressions(ctx, leftInner, true, isInsideParenthesis);
    if (left !== leftInner && hasComment(js, left))
      chain = withOwnComments(ctx, left, chain);
  } else chain = { parts: [() => within(GROUP, () => ctx.print(left))], head: 0 };

  const shouldInline = shouldInlineLogicalExpression(js, node);
  const opTok = field(js, node, "operator");
  const atStart = js.options.experimentalOperatorPosition === "start";
  const commentBeforeOperator = hasLeadingOwnLineComment(js, right);
  let rightDoc: Emit;
  if (shouldInline)
    rightDoc = () => {
      tok(js, opTok);
      if (!commentBeforeOperator) {
        sText(" ");
        ctx.print(right);
      } else
        within(INDENT, () => {
          sLine(0);
          ctx.print(right);
        });
    };
  else if (atStart)
    rightDoc = () => {
      sLine(0);
      // The right operand's own-line leading comments go above the operator, as prettier shifts them off.
      const comments = commentBeforeOperator
        ? commentsOf(ctx, right)
        : undefined;
      if (comments !== undefined) {
        const [leading, trailing] = comments;
        leading();
        tok(js, opTok);
        sText(" ");
        ctx.printBare(right);
        trailing();
      } else {
        tok(js, opTok);
        sText(" ");
        ctx.print(right);
      }
    };
  else
    rightDoc = () => {
      tok(js, opTok);
      sLine(0);
      ctx.print(right);
    };

  const { parent } = role(js, node);
  const shouldBreak = hasComment(js, left, CF.Trailing | CF.Line);
  const estree = estreeKind(js, node);
  const shouldGroup =
    shouldBreak ||
    (!(isInsideParenthesis && estree === "LogicalExpression") &&
      estreeKind(js, parent) !== estree &&
      estreeKind(js, leftInner) !== estree &&
      estreeKind(js, unparen(js, right)) !== estree);
  const parts = [...chain.parts];
  // Prettier's space before a comment-led right operand at the line's start doubles the one before a line
  // comment trailing the left; oxfmt prints one.
  if (
    !atStart ||
    shouldInline ||
    (commentBeforeOperator && js.options.compat !== "oxfmt")
  )
    parts.push(() => sText(" "));
  const printRight = rightDoc;
  parts.push(
    shouldGroup
      ? () => within(GROUP, printRight, -1, shouldBreak ? BROKEN : 0)
      : printRight,
  );
  const result = { parts, head: chain.head };
  return isNested && hasComment(js, node)
    ? withOwnComments(ctx, node, result)
    : result;
}

const isBooleanTypeCoercion = (ctx: JsCtx, n: number | undefined) =>
  n !== undefined &&
  kind(ctx, n) === "call_expression" &&
  (!isOptional(ctx, n) || ctx.options.compat === "oxfmt") &&
  callArguments(ctx, n).length === 1 &&
  kind(ctx, callee(ctx, n)) === "identifier" &&
  src(ctx, callee(ctx, n) as number) === "Boolean";

/** Prettier's printBinaryishExpression: the chain flat, and where its operands after the first indent. */
const binary: CustomRule<JsOptions> = (node, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const { parent, key } = role(js, node);
  const parentKind = kind(js, parent);
  const isInsideParenthesis =
    key !== "body" &&
    (parentKind === "if_statement" ||
      parentKind === "while_statement" ||
      parentKind === "switch_statement" ||
      parentKind === "do_statement");
  const { parts, head } = printBinaryishExpressions(
    ctx,
    node,
    false,
    isInsideParenthesis,
  );
  const run = (list: Emit[]) => {
    for (const emit of list) emit();
  };
  if (isInsideParenthesis) return run(parts);
  if (
    (key === "callee" && isCallOrNew(js, parent)) ||
    (parentKind === "unary_expression" && !hasCommentThroughParens(js, node)) ||
    (parentKind === "member_expression" && key === "object")
  )
    return void within(GROUP, () => {
      within(INDENT, () => {
        sLine(SOFT);
        run(parts);
      });
      sLine(SOFT);
    });
  const grandparent =
    parent !== undefined ? role(js, parent).parent : undefined;
  const shouldNotIndent =
    isReturnOrThrow(js, parent) ||
    (parentKind === "jsx_expression" &&
      kind(js, grandparent) === "jsx_attribute") ||
    (key === "body" && parentKind === "arrow_function") ||
    (key !== "body" && parentKind === "for_statement") ||
    (parentKind === "ternary_expression" &&
      !isReturnOrThrow(js, grandparent) &&
      !isCallOrNew(js, grandparent)) ||
    parentKind === "template_substitution" ||
    (key === "argument" && parentKind === "unary_expression") ||
    (key === "arguments" && isBooleanTypeCoercion(js, parent));
  const shouldIndentIfInlining =
    parentKind === "assignment_expression" ||
    parentKind === "augmented_assignment_expression" ||
    parentKind === "variable_declarator" ||
    parentKind === "public_field_definition" ||
    parentKind === "field_definition" ||
    parentKind === "pair";
  const leftInner = unparen(js, field(js, node, "left") as number);
  const right = logicalRight(js, node) as number;
  const samePrecedenceSubExpression =
    (isBinary(js, leftInner) &&
      shouldFlatten(operator(js, node), operator(js, leftInner))) ||
    right !== field(js, node, "right");
  if (
    shouldNotIndent ||
    (shouldInlineLogicalExpression(js, node) && !samePrecedenceSubExpression) ||
    (!shouldInlineLogicalExpression(js, node) && shouldIndentIfInlining)
  )
    return void within(GROUP, () => run(parts));
  const hasJsx = isJsx(js, unparen(js, right));
  const printChain = () => {
    run(parts.slice(0, head + 1));
    within(INDENT, () => run(parts.slice(head + 1, hasJsx ? -1 : undefined)));
  };
  if (!hasJsx) return void within(GROUP, printChain);
  within(GROUP, () => {
    const chain = within(GROUP, printChain);
    openIndentIfBreak(chain);
    (parts.at(-1) as Emit)();
    close();
  });
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

/** The token `c`, as written; nothing when `c` is undefined. */
const tok = (js: JsCtx, c: number | undefined) => {
  if (c !== undefined) sToken(c, src(js, c));
};

/** `fn`'s output inside an interval of `kind` (GROUP, INDENT, IF_BROKEN, ...), naming group `ref`. */
function within(kind: number, fn: () => void, ref = -1, flags = 0): number {
  const id = open(kind, ref, flags);
  fn();
  close();
  return id;
}

/** `print` inside parentheses of `anchor` while its group breaks: prettier's `[ifBreak("("), indent([softline, x]), softline, ifBreak(")")]`. */
function wrapInParens(anchor: number, print: () => void): void {
  within(IF_BROKEN, () => sToken(anchor, "(", true));
  within(INDENT, () => {
    sLine(SOFT);
    print();
  });
  sLine(SOFT);
  within(IF_BROKEN, () => sToken(anchor, ")", true));
}

/** Prettier's printTernary (ternary-old.js), shared by `a ? b : c` and `A extends B ? C : D`. */
const ternary: CustomRule<JsOptions> = (node, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  if (js.options.experimentalTernaries) return printTernary(node, ctx);
  const TERNARY = kind(js, node);
  const isType = TERNARY === "conditional_type";
  const test = field(js, node, "condition") as number;
  const consequent = field(js, node, "consequence") as number;
  const alternate = field(js, node, "alternative") as number;
  const question = () => tok(js, anon(js, node, "?"));
  const colon = () => tok(js, anon(js, node, ":"));
  const { parent, key } = ternaryRole(js, node);
  const parentKind = kind(js, parent);
  const isParentTest = parentKind === TERNARY && isTestKey(key);
  let forceNoIndent = parentKind === TERNARY && !isParentTest;

  let previous = node;
  let current = parent;
  while (
    current !== undefined &&
    kind(js, current) === TERNARY &&
    !isTestKey(ternaryRole(js, previous).key)
  ) {
    previous = current;
    current = ternaryRole(js, current).parent;
  }
  const firstNonConditionalParent = current ?? parent;
  const lastConditionalParent = previous;

  const consequentInner = bare(js, consequent);
  const alternateInner = bare(js, alternate);
  let parts: () => void;
  let jsxMode = false;
  if (
    (test !== undefined && isJsx(js, unparen(js, test))) ||
    isJsx(js, consequentInner) ||
    isJsx(js, alternateInner) ||
    chainContainsJsx(js, lastConditionalParent)
  ) {
    jsxMode = true;
    forceNoIndent = true;
    parts = () => {
      sText(" ");
      question();
      sText(" ");
      if (isNil(js, consequentInner)) ctx.print(consequent);
      else wrapInParens(consequent, () => ctx.print(consequent));
      sText(" ");
      colon();
      sText(" ");
      if (kind(js, alternateInner) === TERNARY || isNil(js, alternateInner))
        ctx.print(alternate);
      else wrapInParens(alternate, () => ctx.print(alternate));
    };
  } else {
    const printBranch = (n: number) => {
      if (js.options.useTabs) within(INDENT, () => ctx.print(n));
      else {
        openAlign(2);
        ctx.print(n);
        close();
      }
    };
    const nestedConsequent = kind(js, consequentInner) === TERNARY;
    const part = () => {
      sLine(0);
      question();
      sText(" ");
      if (nestedConsequent)
        within(IF_FLAT, () => sToken(consequent, "(", true));
      printBranch(consequent);
      if (nestedConsequent)
        within(IF_FLAT, () => sToken(consequent, ")", true));
      sLine(0);
      colon();
      sText(" ");
      printBranch(alternate);
    };
    parts =
      parentKind !== TERNARY ||
      key === "alternate" ||
      isParentTest ||
      js.options.useTabs
        ? part
        : () => {
            openAlign(Math.max(0, js.options.tabWidth - 2));
            part();
            close();
          };
  }
  const breakClosingParen =
    !jsxMode && parentKind === "member_expression" && key === "object";
  const shouldExtraIndent = shouldExtraIndentForConditionalExpression(
    js,
    node,
  );
  const testOnly = () => {
    if (!isType) return ctx.print(test);
    ctx.print(field(js, node, "left") as number);
    sText(" ");
    tok(js, anon(js, node, "extends"));
    sText(" ");
    ctx.print(field(js, node, "right") as number);
  };
  const result = () => {
    const grouped = parent === firstNonConditionalParent;
    if (grouped) open(GROUP);
    if (parentKind === TERNARY && key === "alternate") {
      openAlign(2);
      testOnly();
      close();
    } else testOnly();
    if (forceNoIndent) parts();
    else within(INDENT, parts);
    if (breakClosingParen && !shouldExtraIndent) sLine(SOFT);
    if (grouped) close();
  };
  if (!(isParentTest || shouldExtraIndent)) return result();
  within(GROUP, () => {
    within(INDENT, () => {
      sLine(SOFT);
      result();
    });
    sLine(SOFT);
  });
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

/** Prettier's printTernary (ternary.js) under experimentalTernaries, for `a ? b : c` and `A extends B ? C : D`. */
function printTernary(node: number, ctx: JsStreamCtx): void {
  const js = ctx.js;
  const args = ctx.args;
  const nodeKind = kind(js, node);
  const isConditionalExpression = nodeKind === TERNARY;
  const isTSConditional = !isConditionalExpression;
  const test = field(js, node, "condition");
  const testNodes = isConditionalExpression
    ? [test]
    : [field(js, node, "left"), field(js, node, "right")];
  const consequentNode = field(js, node, "consequence") as number;
  const alternateNode = field(js, node, "alternative") as number;
  const { parent, key } = ternaryRole(js, node);
  const isParentTernary = kind(js, parent) === nodeKind;
  const isInTest = isParentTernary && isTestKey(key);
  const isInAlternate = isParentTernary && key === "alternate";
  const isConsequentTernary = kind(js, bare(js, consequentNode)) === nodeKind;
  const isAlternateTernary = kind(js, bare(js, alternateNode)) === nodeKind;
  const isInChain = isAlternateTernary || isInAlternate;
  const isBigTabs = js.options.tabWidth > 2 || js.options.useTabs;

  let previous = node;
  let current = parent;
  while (
    current !== undefined &&
    kind(js, current) === nodeKind &&
    !isTestKey(ternaryRole(js, previous).key)
  ) {
    previous = current;
    current = ternaryRole(js, current).parent;
  }
  const firstNonConditionalParent = current ?? parent;

  const isOnSameLineAsAssignment =
    args?.assignmentLayout !== undefined &&
    args.assignmentLayout !== "break-after-operator" &&
    parent !== undefined &&
    SAME_LINE_ASSIGNMENT_PARENTS.has(kind(js, parent));
  const isOnSameLineAsReturn =
    isReturnOrThrow(js, parent) &&
    !(isConsequentTernary || isAlternateTernary);
  const isInJsx =
    isConditionalExpression &&
    kind(js, firstNonConditionalParent) === "jsx_expression" &&
    kind(js, parent !== undefined ? role(js, parent).parent : undefined) !==
      "jsx_attribute";

  const shouldExtraIndent = shouldExtraIndentForConditionalExpression(js, node);
  const breakClosingParen =
    kind(js, parent) === "member_expression" && key === "object";
  const breakTSClosingParen = isTSConditional && typeNeedsParens(js, node);
  const fillTab = !isBigTabs
    ? ""
    : js.options.useTabs
      ? "\t"
      : " ".repeat(js.options.tabWidth - 1);

  const hasMultilineBlockComments = [
    ...testNodes,
    consequentNode,
    alternateNode,
  ].some((n) =>
    getComments(js, n).some(
      (c) => isBlockComment(js, c) && hasNewlineIn(js, c),
    ),
  );
  // A chain breaks as a whole, so only its outermost ternary is grouped.
  const shouldBreak =
    hasMultilineBlockComments || isConsequentTernary || isAlternateTernary;

  // `const result = foo != null ? foo : (\n  some + long + expression\n);` keeps a short consequent up.
  const consequentInner = unparen(js, consequentNode);
  const tryToParenthesizeAlternate =
    !isInChain &&
    !isParentTernary &&
    !isTSConditional &&
    (isInJsx
      ? kind(js, consequentInner) === "null"
      : isLoneShortArgument(js, consequentNode) &&
        isSimpleExpressionByNodeCount(js, test as number, 3));

  const shouldGroupTestAndConsequent =
    isInChain ||
    isInAlternate ||
    (isTSConditional && !isParentTernary) ||
    (isParentTernary &&
      isConditionalExpression &&
      isSimpleExpressionByNodeCount(js, test as number, 1)) ||
    tryToParenthesizeAlternate;

  const dangling = [
    ...(test !== undefined ? [ctx.danglingComments(test)] : []),
    ctx.danglingComments(node),
  ].filter((cs) => cs.length > 0);

  const testGroup = () =>
    within(GROUP, () => {
      if (test !== undefined) {
        wrapInParens(test, () => ctx.print(test));
        if (kind(js, unparen(js, test)) === TERNARY) sBreakParent();
      } else {
        const ext = field(js, node, "right") as number;
        ctx.print(field(js, node, "left") as number);
        sText(" ");
        tok(js, anon(js, node, "extends"));
        sText(" ");
        if (
          kind(js, bare(js, ext)) === nodeKind ||
          (kind(js, bare(js, ext)) === "object_type" &&
            mappedClauseOf(js, bare(js, ext)) !== undefined)
        )
          ctx.print(ext);
        else within(GROUP, () => wrapInParens(ext, () => ctx.print(ext)));
      }
      sText(" ");
      tok(js, anon(js, node, "?"));
    });

  const consequent = () =>
    within(INDENT, () => {
      if (
        isConsequentTernary ||
        (isInJsx &&
          (isJsx(js, consequentInner) || isParentTernary || isInChain))
      )
        sHardline();
      else sLine(0);
      ctx.print(consequentNode);
    });

  const parts = () => {
    // Unless in a chain, a broken test breaks the consequent too.
    let testAndConsequent = -1;
    if (shouldGroupTestAndConsequent)
      testAndConsequent = within(GROUP, () => {
        const tg = testGroup();
        if (isInChain) return consequent();
        const printed = capture(consequent);
        within(IF_BROKEN, () => place(printed), tg);
        within(IF_FLAT, () => within(GROUP, () => place(printed)), tg);
      });
    else {
      testGroup();
      consequent();
    }
    const ifBroken = (broken: () => void, flat: () => void) => {
      within(IF_BROKEN, broken, testAndConsequent);
      within(IF_FLAT, flat, testAndConsequent);
    };

    if (dangling.length > 0) {
      within(INDENT, () => {
        sHardline();
        for (const cs of dangling)
          cs.forEach((c, i) => {
            if (i > 0) sHardline();
            ctx.comment(c);
          });
      });
      sHardline();
    } else if (isAlternateTernary) sHardline();
    else if (tryToParenthesizeAlternate)
      ifBroken(
        () => sLine(0),
        () => sText(" "),
      );
    else sLine(0);
    tok(js, anon(js, node, ":"));
    if (isAlternateTernary || !isBigTabs) sText(" ");
    else if (shouldGroupTestAndConsequent)
      ifBroken(
        () => sText(fillTab),
        () => {
          within(IF_BROKEN, () =>
            sText(isInChain || tryToParenthesizeAlternate ? " " : fillTab),
          );
          within(IF_FLAT, () => sText(" "));
        },
      );
    else {
      within(IF_BROKEN, () => sText(fillTab));
      within(IF_FLAT, () => sText(" "));
    }

    const alternate = () => {
      if (!(tryToParenthesizeAlternate && testAndConsequent !== -1))
        return ctx.print(alternateNode);
      const printed: Part = capture(() => ctx.print(alternateNode));
      ifBroken(
        () => place(printed),
        () => {
          openAlign(-1);
          wrapInParens(alternateNode, () => place(printed));
          close();
        },
      );
    };
    if (isAlternateTernary) alternate();
    else
      within(GROUP, () => {
        within(INDENT, alternate);
        if (isInJsx && !tryToParenthesizeAlternate) sLine(SOFT);
      });
    if (breakClosingParen && !shouldExtraIndent) sLine(SOFT);
    if (shouldBreak) sBreakParent();
  };

  // A one-line ternary bumped past `=` stays one line there.
  if (isOnSameLineAsAssignment && !shouldBreak)
    within(GROUP, () =>
      within(INDENT, () => {
        sLine(SOFT);
        within(GROUP, parts);
      }),
    );
  else if (isOnSameLineAsAssignment || isOnSameLineAsReturn)
    within(GROUP, () => within(INDENT, parts));
  else if (shouldExtraIndent || (isTSConditional && isInTest))
    within(GROUP, () => {
      within(INDENT, () => {
        sLine(SOFT);
        parts();
      });
      if (breakTSClosingParen) sLine(SOFT);
    });
  else if (parent === firstNonConditionalParent) within(GROUP, parts);
  else parts();
}

// --- the rest --------------------------------------------------------------------------------------------------

/** Whether `target` is the leftmost node of expression `n` (prettier's startsWithNoLookaheadToken). */
export function startsWith(
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

/** `a = b` and `a += b`, laid out by printAssignment. */
const assignment: CustomRule<JsOptions> = (node, sctx) => {
  const ctx = jsCtx(sctx);
  const js = ctx.js;
  const left = field(js, node, "left");
  const op = field(js, node, "operator") ?? anon(js, node, "=");
  sPrintAssignment(
    ctx,
    node,
    () => {
      if (left !== undefined) ctx.print(left);
    },
    () => {
      sText(" ");
      tok(js, op);
    },
    field(js, node, "right"),
  );
};

/** The customs of format.ts's operator kinds. */
export const operatorCustoms = {
  assignment,
  binary,
  ternary,
} satisfies Record<string, CustomRule<JsOptions>>;
