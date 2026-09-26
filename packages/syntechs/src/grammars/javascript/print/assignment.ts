// Prettier's assignment layouts (print/assignment.js): how `left = right`, a declarator, an object property
// and a class property break.

import {
  type Doc,
  group,
  indent,
  indentIfBreak,
  line,
  lineSuffixBoundary,
  text,
} from "../../../fmt/doc.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { textWidth } from "../../../fmt/width.js";
import { printsAsMemberChain } from "./calls.js";
import { printString } from "./literals.js";
import { role } from "./parens.js";
import {
  CF,
  callArguments,
  callee,
  canBreak,
  docText,
  field,
  first,
  hasComment,
  hasLeadingOwnLineComment,
  isAssignment,
  isBinaryish,
  isBoolean,
  isIndentableBlockComment,
  isLogical,
  isMember,
  items,
  type JsCtx,
  objectOf,
  src,
  unparen,
} from "./util.js";

export type AssignmentLayout =
  | "break-after-operator"
  | "never-break-after-operator"
  | "fluid"
  | "break-lhs"
  | "chain"
  | "chain-tail"
  | "chain-tail-arrow-chain"
  | "only-left";

/**
 * Prettier's printAssignment: `left`, `operator` (with its leading space), then `right` (printed with the chosen
 * layout as `assignmentLayout`) in one of its layouts.
 */
export function printAssignment(
  ctx: JsCtx,
  node: FormatNode,
  left: Doc,
  operator: Doc,
  right: FormatNode | undefined,
): Doc {
  const layout = chooseLayout(ctx, node, left, right);
  const rightDoc: Doc = right
    ? ctx.print(right, { assignmentLayout: layout })
    : [];
  switch (layout) {
    case "break-after-operator":
      return group([group(left), operator, group(indent([line, rightDoc]))]);
    case "never-break-after-operator":
      return group([group(left), operator, text(" "), rightDoc]);
    case "fluid": {
      const g = group(indent(line));
      return group([
        group(left),
        operator,
        g,
        lineSuffixBoundary,
        indentIfBreak(rightDoc, g),
      ]);
    }
    case "break-lhs":
      return group([left, operator, text(" "), group(rightDoc)]);
    case "chain":
      return [group(left), operator, line, rightDoc];
    case "chain-tail":
      return [group(left), operator, indent([line, rightDoc])];
    case "chain-tail-arrow-chain":
      return [group(left), operator, rightDoc];
    case "only-left":
      return left;
  }
}

const isDeclarator = (n: FormatNode | undefined) =>
  n?.kind === "variable_declarator";
const isAssignmentOrDeclarator = (n: FormatNode | undefined) =>
  isAssignment(n) || isDeclarator(n);
const isArrow = (n: FormatNode | undefined) => n?.kind === "arrow_function";
const isObjectProperty = (n: FormatNode) => n.kind === "pair";

function chooseLayout(
  ctx: JsCtx,
  node: FormatNode,
  left: Doc,
  rightNode: FormatNode | undefined,
): AssignmentLayout {
  if (!rightNode) return "only-left";
  const right = unparen(rightNode);
  const isTail = !isAssignment(right);
  const parent = role(node).parent;
  const grandparent = parent && role(parent).parent;
  // `a = b = c`: prettier's path.match(isAssignment, isAssignmentOrVariableDeclarator, ...).
  if (
    isAssignment(node) &&
    isAssignmentOrDeclarator(parent) &&
    grandparent &&
    (!isTail ||
      (grandparent.kind !== "expression_statement" &&
        !grandparent.kind.endsWith("declaration")))
  )
    return !isTail
      ? "chain"
      : isArrow(right) && isArrow(unparen(field(right, "body") ?? right))
        ? "chain-tail-arrow-chain"
        : "chain-tail";
  const isHeadOfLongChain =
    !isTail && isAssignment(unparen(field(right, "right") ?? right));
  if (
    isHeadOfLongChain ||
    (right.kind === "union_type" && !shouldHugUnion(ctx, right)) ||
    hasLeadingOwnLineComment(ctx, rightNode) ||
    hasComment(ctx, rightNode, CF.Leading, (c) =>
      isIndentableBlockComment(ctx, c),
    )
  )
    return "break-after-operator";
  if (
    node.kind === "import_attribute" ||
    (right.kind === "call_expression" &&
      src(ctx, callee(right) ?? right) === "require")
  )
    return "never-break-after-operator";
  const canBreakLeft = canBreak(left);
  if (
    isComplexDestructuring(node) ||
    hasComplexTypeAnnotation(node) ||
    (isDeclarator(node) && isArrow(right) && canBreakLeft)
  )
    return "break-lhs";
  const hasShortKey = isObjectPropertyWithShortKey(ctx, node, left);
  if (shouldBreakAfterOperator(ctx, rightNode, hasShortKey))
    return "break-after-operator";
  if (isComplexTypeAliasParams(node)) return "break-lhs";
  if (
    !canBreakLeft &&
    (hasShortKey ||
      right.kind === "template_string" ||
      (right.kind === "call_expression" &&
        field(right, "arguments")?.kind === "template_string") ||
      isBoolean(right) ||
      right.kind === "number" ||
      right.kind === "class")
  )
    return "never-break-after-operator";
  return "fluid";
}

/** Prettier's shouldInlineLogicalExpression. */
export function shouldInlineLogicalExpression(n: FormatNode): boolean {
  if (!isLogical(n)) return false;
  const r = unparen(field(n, "right") ?? n);
  if (r.kind === "object") return items(r).length > 0;
  if (r.kind === "array") return items(r).length > 0;
  return r.kind === "jsx_element" || r.kind === "jsx_self_closing_element";
}

function shouldBreakAfterOperator(
  ctx: JsCtx,
  rightNode: FormatNode,
  hasShortKey: boolean,
): boolean {
  const right = unparen(rightNode);
  if (isBinaryish(right) && !shouldInlineLogicalExpression(right)) return true;
  switch (right.kind) {
    case "sequence_expression":
      return true;
    case "conditional_type": {
      const check = unparenType(field(right, "left"));
      const ext = unparenType(field(right, "right"));
      if (isGenericType(check) || isGenericType(ext)) return true;
      break;
    }
    case "ternary_expression": {
      const test = unparen(field(right, "condition") ?? right);
      return isBinaryish(test) && !shouldInlineLogicalExpression(test);
    }
    case "class":
      return right.children.some((c) => c.kind === "decorator");
  }
  if (hasShortKey) return false;
  let n = right;
  for (;;) {
    if (
      n.kind === "unary_expression" ||
      n.kind === "await_expression" ||
      (n.kind === "yield_expression" && first(n))
    ) {
      const a = field(n, "argument") ?? first(n);
      if (!a) break;
      n = unparen(a);
    } else if (n.kind === "non_null_expression") {
      const a = first(n);
      if (!a) break;
      n = unparen(a);
    } else break;
  }
  return n.kind === "string" || isPoorlyBreakableMemberOrCallChain(ctx, n);
}

function isPoorlyBreakableMemberOrCallChain(
  ctx: JsCtx,
  n: FormatNode,
  deep = false,
): boolean {
  n = unparen(n);
  if (n.kind === "call_expression" || n.kind === "new_expression") {
    if (field(n, "arguments")?.kind === "template_string") return false;
    if (printsAsMemberChain(ctx, n)) return false;
    const args = callArguments(n);
    const poor =
      args.length === 0 ||
      (args.length === 1 &&
        args[0] !== undefined &&
        isLoneShortArgument(ctx, args[0]));
    if (!poor) return false;
    if (isCallWithComplexTypeArguments(n)) return false;
    const c = callee(n);
    return c !== undefined && isPoorlyBreakableMemberOrCallChain(ctx, c, true);
  }
  if (isMember(n)) {
    const o = objectOf(n);
    return o !== undefined && isPoorlyBreakableMemberOrCallChain(ctx, o, true);
  }
  if (n.kind === "non_null_expression") {
    const o = first(n);
    return o !== undefined && isPoorlyBreakableMemberOrCallChain(ctx, o, deep);
  }
  return deep && (n.kind === "identifier" || n.kind === "this");
}

function isCallWithComplexTypeArguments(n: FormatNode): boolean {
  const args = field(n, "type_arguments");
  if (!args) return false;
  const params = items(args);
  if (params.length > 1) return true;
  const only = params[0];
  if (
    only &&
    (only.kind === "union_type" ||
      only.kind === "intersection_type" ||
      only.kind === "object_type")
  )
    return true;
  return false;
}

/** Prettier's isLoneShortArgument (utilities/is-lone-short-argument.js). */
export function isLoneShortArgument(
  ctx: JsCtx,
  n: FormatNode,
  printWidth = ctx.options.printWidth,
): boolean {
  if (hasComment(ctx, n)) return false;
  const threshold = printWidth * 0.25;
  n = unparen(n);
  if (n.kind === "this") return true;
  if (n.kind === "identifier" || n.kind === "undefined")
    return textWidth(src(ctx, n)) <= threshold;
  if (n.kind === "unary_expression") {
    const op = field(n, "operator")?.kind;
    const arg = field(n, "argument");
    if (
      (op === "+" || op === "-") &&
      arg &&
      unparen(arg).kind === "number" &&
      !hasComment(ctx, arg)
    )
      return true;
    return arg !== undefined && isLoneShortArgument(ctx, arg, printWidth);
  }
  if (n.kind === "regex")
    return src(ctx, field(n, "pattern") ?? n).length <= threshold;
  if (n.kind === "string")
    return (
      printString(src(ctx, n), ctx.options.singleQuote).length <= threshold
    );
  if (n.kind === "template_string") {
    const raw = src(ctx, n).slice(1, -1);
    return (
      !n.children.some((c) => c.kind === "template_substitution") &&
      raw.length <= threshold &&
      !raw.includes("\n")
    );
  }
  if (
    n.kind === "call_expression" &&
    field(n, "arguments")?.kind === "arguments"
  ) {
    const c = callee(n);
    return (
      callArguments(n).length === 0 &&
      c?.kind === "identifier" &&
      src(ctx, c).length <= threshold - 2
    );
  }
  return ["number", "true", "false", "null"].includes(n.kind);
}

function isComplexDestructuring(node: FormatNode): boolean {
  if (!isAssignmentOrDeclarator(node)) return false;
  const left = field(node, "left") ?? field(node, "name");
  if (!left || unparen(left).kind !== "object_pattern") return false;
  const props = items(unparen(left));
  return (
    props.length > 2 &&
    props.some(
      (p) =>
        p.kind === "pair_pattern" ||
        // `{ a = 1 }`: a shorthand property whose value is an assignment pattern.
        p.kind === "object_assignment_pattern",
    )
  );
}

function hasComplexTypeAnnotation(node: FormatNode): boolean {
  if (!isDeclarator(node)) return false;
  const annotation = field(node, "type");
  const type = annotation && first(annotation);
  const params = type && typeArgumentsOf(type);
  return (
    params !== undefined &&
    params.length > 1 &&
    params.some(
      (p) =>
        (typeArgumentsOf(p)?.length ?? 0) > 0 || p.kind === "conditional_type",
    )
  );
}

function typeArgumentsOf(type: FormatNode): FormatNode[] | undefined {
  if (type.kind !== "generic_type") return undefined;
  const args = field(type, "type_arguments");
  return args ? items(args) : undefined;
}

function isComplexTypeAliasParams(node: FormatNode): boolean {
  if (node.kind !== "type_alias_declaration") return false;
  const params = field(node, "type_parameters");
  if (!params) return false;
  const list = items(params);
  return (
    list.length > 1 &&
    list.some(
      (p) =>
        field(p, "constraint") !== undefined || field(p, "value") !== undefined,
    )
  );
}

const unparenType = (n: FormatNode | undefined) => {
  while (n?.kind === "parenthesized_type") n = first(n);
  return n;
};
const isGenericType = (n: FormatNode | undefined) =>
  (n?.kind === "generic_type" && field(n, "type_arguments") !== undefined) ||
  (n?.kind === "function_type" && field(n, "type_parameters") !== undefined);

function isObjectPropertyWithShortKey(
  ctx: JsCtx,
  node: FormatNode,
  keyDoc: Doc,
): boolean {
  if (!isObjectProperty(node)) return false;
  const key = docText(keyDoc);
  return key !== undefined && textWidth(key) < ctx.options.tabWidth + 3;
}

/** Prettier's shouldHugTheOnlyFunctionParameter-style union hug (union-type-print.js shouldHugType). */
function shouldHugUnion(ctx: JsCtx, n: FormatNode): boolean {
  const members = items(n);
  const objects = members.filter((m) => m.kind === "object_type");
  const nulls = members.filter(
    (m) =>
      (m.kind === "predefined_type" || m.kind === "literal_type") &&
      /^(?:void|null|undefined)$/.test(src(ctx, m)),
  );
  return (
    objects.length === 1 &&
    nulls.length + objects.length === members.length &&
    !hasComment(ctx, n)
  );
}
