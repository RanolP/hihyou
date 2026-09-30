// Prettier's assignment layouts (print/assignment.js): how `left = right`, a declarator, an object property
// and a class property break.

import { NO_NODE } from "../../../core/arena.js";
import { nextLeaf } from "../../../fmt/tree.js";
import { textWidth } from "../../../fmt/width.js";
import {
  capture,
  canBreak,
  close,
  flatText,
  GROUP,
  INDENT,
  type JsStreamCtx,
  open,
  openIndentIfBreak,
  type Part,
  place,
  sBreakParent,
  sLine,
  sLineSuffixBoundary,
  sText,
} from "../sink.js";
import { printsAsMemberChain } from "./calls.js";
import { printString } from "../../../fmt/dsl/normalizers.js";
import { role } from "./parens.js";
import { shouldHugUnionType, unparenType } from "./types.js";
import {
  anon,
  CF,
  callArguments,
  callee,
  childWhere,
  children,
  field,
  first,
  type HasTree,
  hasComment,
  hasLeadingOwnLineComment,
  isAssignment,
  isBinaryish,
  isBoolean,
  isComment,
  isIndentableBlockComment,
  isLogical,
  isMember,
  items,
  type JsCtx,
  kind,
  objectOf,
  operator,
  src,
  unparen,
} from "./util.js";
import type { CustomRule } from "../../../fmt/dsl/runtime.js";
import type { JsOptions } from "./util.js";

/** The customs format/assignment.ts names, by the names its spec gives them. */
export const assignmentCustoms = {} satisfies Record<string, CustomRule<JsOptions>>;

export type AssignmentLayout =
  | "break-after-operator"
  | "never-break-after-operator"
  | "fluid"
  | "break-lhs"
  | "chain"
  | "chain-tail"
  | "chain-tail-arrow-chain"
  | "only-left";

/** `fn`'s output inside an interval of `kind`; the interval's id. */
function within(kind: number, fn: () => void): number {
  const id = open(kind);
  fn();
  close();
  return id;
}

/**
 * Prettier's printAssignment: `left`, `operator` (with its leading space), then `right` (printed with the chosen
 * layout as `assignmentLayout`) in one of its layouts. `left` is captured, since the layout reads it.
 */
export function sPrintAssignment(
  ctx: JsStreamCtx,
  node: number,
  left: () => void,
  operator: () => void,
  right: number | undefined,
): void {
  const leftPart = capture(left);
  const chosen = chooseLayout(ctx, node, leftPart, right);
  const breakAfter = right !== undefined && oxfmtLineCommentBeforeRight(ctx.js, node, right);
  const layout =
    breakAfter && (chosen === "fluid" || chosen === "never-break-after-operator") ? "break-after-operator" : chosen;
  const printRight = () => {
    if (right !== undefined) ctx.print(right, { assignmentLayout: layout });
  };
  const groupedLeft = () => within(GROUP, () => place(leftPart));
  switch (layout) {
    case "break-after-operator":
      return void within(GROUP, () => {
        groupedLeft();
        operator();
        // oxfmt leaves the break to the group a line comment ending the `=` line breaks, and groups the right.
        if (operatorLineComment(ctx.js, node))
          return void within(INDENT, () => {
            sLine(0);
            within(GROUP, printRight);
          });
        within(GROUP, () =>
          within(INDENT, () => {
            if (breakAfter) sBreakParent();
            sLine(0);
            printRight();
          }),
        );
      });
    case "never-break-after-operator":
      return void within(GROUP, () => {
        groupedLeft();
        operator();
        sText(" ");
        printRight();
      });
    case "fluid":
      return void within(GROUP, () => {
        groupedLeft();
        operator();
        const g = within(GROUP, () => within(INDENT, () => sLine(0)));
        sLineSuffixBoundary();
        openIndentIfBreak(g);
        printRight();
        close();
      });
    case "break-lhs":
      return void within(GROUP, () => {
        place(leftPart);
        operator();
        sText(" ");
        within(GROUP, printRight);
      });
    case "chain":
      groupedLeft();
      operator();
      sLine(0);
      return printRight();
    case "chain-tail":
      groupedLeft();
      operator();
      return void within(INDENT, () => {
        if (breakAfter) sBreakParent();
        sLine(0);
        printRight();
      });
    case "chain-tail-arrow-chain":
      groupedLeft();
      operator();
      return printRight();
    case "only-left":
      return place(leftPart);
  }
}

/**
 * `a = // c⏎1`: oxfmt keeps a line comment that ends the line of the `=` (or of the left side, before it) there
 * and breaks the right side onto the next line, where prettier's layout may pull the right side up before it.
 */
function oxfmtLineCommentBeforeRight(x: JsCtx, node: number, right: number): boolean {
  if (x.options.compat !== "oxfmt") return false;
  for (const c of children(x, node)) {
    if (c === right) return false;
    if (kind(x, c) === "comment" && src(x, c).startsWith("//") && x.tree.lf(c) === 0) return true;
  }
  return false;
}

/** oxfmt's has_line_comment_on_operator_line, over a type alias: `type A = // c`. */
function operatorLineComment(x: JsCtx, node: number): boolean {
  if (x.options.compat !== "oxfmt" || kind(x, node) !== "type_alias_declaration") return false;
  const op = anon(x, node, "=");
  if (op === undefined) return false;
  const next = nextLeaf(x.tree, op);
  return next !== NO_NODE && isComment(x, next) && src(x, next).startsWith("//");
}

const isDeclarator = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "variable_declarator";
const isAssignmentOrDeclarator = (x: HasTree, n: number | undefined) =>
  isAssignment(x, n) || isDeclarator(x, n);
const isArrow = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "arrow_function";
const isObjectProperty = (x: HasTree, n: number) => kind(x, n) === "pair";

function chooseLayout(
  s: JsStreamCtx,
  node: number,
  left: Part,
  rightNode: number | undefined,
): AssignmentLayout {
  const ctx = s.js;
  if (rightNode === undefined) return "only-left";
  const right = unparen(ctx, rightNode);
  const isTail = !isAssignment(ctx, right);
  const parent = role(ctx, node).parent;
  const grandparent =
    parent !== undefined ? role(ctx, parent).parent : undefined;
  // `a = b = c`: prettier's path.match(isAssignment, isAssignmentOrVariableDeclarator, ...).
  if (
    isAssignment(ctx, node) &&
    isAssignmentOrDeclarator(ctx, parent) &&
    grandparent !== undefined &&
    (!isTail ||
      (kind(ctx, grandparent) !== "expression_statement" &&
        !kind(ctx, grandparent).endsWith("declaration")))
  )
    return !isTail
      ? "chain"
      : isArrow(ctx, right) &&
          isArrow(ctx, unparen(ctx, field(ctx, right, "body") ?? right))
        ? "chain-tail-arrow-chain"
        : "chain-tail";
  const rightType = unparenType(ctx, right) ?? right;
  const isHeadOfLongChain =
    !isTail &&
    isAssignment(ctx, unparen(ctx, field(ctx, right, "right") ?? right));
  if (
    isHeadOfLongChain ||
    (kind(ctx, rightType) === "union_type" &&
      !shouldHugUnionType(ctx, rightType)) ||
    // A one-type union's `| // c` comment leads the type inside, which is prettier's right side.
    [rightNode, rightType].some(
      (n) =>
        hasLeadingOwnLineComment(ctx, n) ||
        hasComment(ctx, n, CF.Leading, (c) => isIndentableBlockComment(ctx, c)),
    )
  )
    return "break-after-operator";
  if (
    kind(ctx, node) === "import_attribute" ||
    (kind(ctx, right) === "call_expression" &&
      src(ctx, callee(ctx, right) ?? right) === "require")
  )
    return "never-break-after-operator";
  const canBreakLeft = canBreak(left);
  if (
    isComplexDestructuring(ctx, node) ||
    hasComplexTypeAnnotation(ctx, node) ||
    (isDeclarator(ctx, node) && isArrow(ctx, right) && canBreakLeft)
  )
    return "break-lhs";
  const hasShortKey = isObjectPropertyWithShortKey(ctx, node, left);
  if (shouldBreakAfterOperator(s, rightNode, hasShortKey))
    return "break-after-operator";
  if (isComplexTypeAliasParams(ctx, node)) return "break-lhs";
  const rightKind = kind(ctx, right);
  if (
    !canBreakLeft &&
    (hasShortKey ||
      rightKind === "template_string" ||
      (rightKind === "call_expression" &&
        kind(ctx, field(ctx, right, "arguments")) === "template_string") ||
      isBoolean(ctx, right) ||
      rightKind === "number" ||
      rightKind === "class")
  )
    return "never-break-after-operator";
  return "fluid";
}

/** Prettier's shouldInlineLogicalExpression. */
/**
 * `n`'s right operand once prettier's parser has rebalanced `a || (b || c)` into `(a || b) || c`: the end of
 * the right spine that repeats `n`'s logical operator.
 */
export function logicalRight(x: HasTree, n: number): number | undefined {
  let r = field(x, n, "right");
  if (!isLogical(x, n)) return r;
  for (;;) {
    const inner = r !== undefined ? unparen(x, r) : undefined;
    if (
      inner === undefined ||
      !isLogical(x, inner) ||
      operator(x, inner) !== operator(x, n)
    )
      return r;
    r = field(x, inner, "right");
  }
}

export function shouldInlineLogicalExpression(x: HasTree, n: number): boolean {
  if (!isLogical(x, n)) return false;
  const r = unparen(x, logicalRight(x, n) ?? n);
  const k = kind(x, r);
  if (k === "object") return items(x, r).length > 0;
  if (k === "array") return items(x, r).length > 0;
  return k === "jsx_element" || k === "jsx_self_closing_element";
}

function shouldBreakAfterOperator(
  s: JsStreamCtx,
  rightNode: number,
  hasShortKey: boolean,
): boolean {
  const ctx = s.js;
  const right = unparen(ctx, rightNode);
  if (isBinaryish(ctx, right) && !shouldInlineLogicalExpression(ctx, right))
    return true;
  switch (kind(ctx, right)) {
    case "sequence_expression":
      return true;
    case "conditional_type": {
      if (ctx.options.experimentalTernaries) return true;
      const check = unparenType(ctx, field(ctx, right, "left"));
      const ext = unparenType(ctx, field(ctx, right, "right"));
      if (isGenericType(ctx, check) || isGenericType(ctx, ext)) return true;
      break;
    }
    case "ternary_expression": {
      if (ctx.options.experimentalTernaries)
        return [
          field(ctx, right, "consequence"),
          field(ctx, right, "alternative"),
        ].some(
          (b) =>
            b !== undefined &&
            kind(ctx, unparen(ctx, b)) === "ternary_expression",
        );
      const test = unparen(ctx, field(ctx, right, "condition") ?? right);
      return (
        isBinaryish(ctx, test) && !shouldInlineLogicalExpression(ctx, test)
      );
    }
    case "class":
      return (
        childWhere(ctx, right, (c) => kind(ctx, c) === "decorator") !==
        undefined
      );
  }
  if (hasShortKey) return false;
  let n = right;
  for (;;) {
    const k = kind(ctx, n);
    if (
      k === "unary_expression" ||
      k === "await_expression" ||
      (k === "yield_expression" && first(ctx, n) !== undefined)
    ) {
      const a = field(ctx, n, "argument") ?? first(ctx, n);
      if (a === undefined) break;
      n = unparen(ctx, a);
    } else if (k === "non_null_expression") {
      const a = first(ctx, n);
      if (a === undefined) break;
      n = unparen(ctx, a);
    } else break;
  }
  return (
    kind(ctx, n) === "string" || isPoorlyBreakableMemberOrCallChain(s, n)
  );
}

function isPoorlyBreakableMemberOrCallChain(
  s: JsStreamCtx,
  n: number,
  deep = false,
): boolean {
  const ctx = s.js;
  n = unparen(ctx, n);
  const k = kind(ctx, n);
  // Prettier's isCallExpression leaves out `new`, so `a = new Foo()` is never a poorly breakable chain.
  if (k === "call_expression") {
    if (kind(ctx, field(ctx, n, "arguments")) === "template_string")
      return false;
    if (printsAsMemberChain(s, n)) return false;
    const args = callArguments(ctx, n);
    // oxfmt hugs `x = f(/* c */)` rather than breaking after `=`.
    const argList = field(ctx, n, "arguments");
    if (
      args.length === 0 &&
      ctx.options.compat === "oxfmt" &&
      argList !== undefined &&
      ctx.comments(argList).dangling.length > 0
    )
      return false;
    const poor =
      args.length === 0 ||
      (args.length === 1 &&
        args[0] !== undefined &&
        isLoneShortArgument(ctx, args[0]));
    if (!poor) return false;
    if (isCallWithComplexTypeArguments(ctx, n)) return false;
    const c = callee(ctx, n);
    return c !== undefined && isPoorlyBreakableMemberOrCallChain(s, c, true);
  }
  if (isMember(ctx, n)) {
    const o = objectOf(ctx, n);
    return o !== undefined && isPoorlyBreakableMemberOrCallChain(s, o, true);
  }
  if (k === "non_null_expression") {
    const o = first(ctx, n);
    return o !== undefined && isPoorlyBreakableMemberOrCallChain(s, o, deep);
  }
  return deep && (k === "identifier" || k === "this");
}

function isCallWithComplexTypeArguments(x: HasTree, n: number): boolean {
  const args = field(x, n, "type_arguments");
  if (args === undefined) return false;
  const params = items(x, args);
  if (params.length > 1) return true;
  const only = kind(x, params[0]);
  if (
    only === "union_type" ||
    only === "intersection_type" ||
    only === "object_type"
  )
    return true;
  return false;
}

/** Prettier's isLoneShortArgument (utilities/is-lone-short-argument.js). */
export function isLoneShortArgument(
  ctx: JsCtx,
  n: number,
  printWidth = ctx.options.printWidth,
): boolean {
  if (hasComment(ctx, n)) return false;
  const threshold = printWidth * 0.25;
  n = unparen(ctx, n);
  const k = kind(ctx, n);
  if (k === "this") return true;
  if (k === "identifier" || k === "undefined")
    return textWidth(src(ctx, n)) <= threshold;
  if (k === "unary_expression") {
    const op = kind(ctx, field(ctx, n, "operator"));
    const arg = field(ctx, n, "argument");
    if (
      (op === "+" || op === "-") &&
      arg !== undefined &&
      kind(ctx, unparen(ctx, arg)) === "number" &&
      !hasComment(ctx, arg)
    )
      return true;
    return arg !== undefined && isLoneShortArgument(ctx, arg, printWidth);
  }
  if (k === "regex")
    return src(ctx, field(ctx, n, "pattern") ?? n).length <= threshold;
  if (k === "string")
    return (
      printString(src(ctx, n), ctx.options.singleQuote).length <= threshold
    );
  if (k === "template_string") {
    const raw = src(ctx, n).slice(1, -1);
    return (
      childWhere(ctx, n, (c) => kind(ctx, c) === "template_substitution") ===
        undefined &&
      raw.length <= threshold &&
      !raw.includes("\n")
    );
  }
  if (
    k === "call_expression" &&
    kind(ctx, field(ctx, n, "arguments")) === "arguments"
  ) {
    const c = callee(ctx, n);
    return (
      callArguments(ctx, n).length === 0 &&
      c !== undefined &&
      kind(ctx, c) === "identifier" &&
      src(ctx, c).length <= threshold - 2
    );
  }
  return ["number", "true", "false", "null"].includes(k);
}

function isComplexDestructuring(x: HasTree, node: number): boolean {
  if (!isAssignmentOrDeclarator(x, node)) return false;
  const left = field(x, node, "left") ?? field(x, node, "name");
  if (left === undefined || kind(x, unparen(x, left)) !== "object_pattern")
    return false;
  const props = items(x, unparen(x, left));
  return (
    props.length > 2 &&
    props.some(
      (p) =>
        kind(x, p) === "pair_pattern" ||
        // `{ a = 1 }`: a shorthand property whose value is an assignment pattern.
        kind(x, p) === "object_assignment_pattern",
    )
  );
}

function hasComplexTypeAnnotation(x: HasTree, node: number): boolean {
  if (!isDeclarator(x, node)) return false;
  const annotation = field(x, node, "type");
  const type = annotation !== undefined ? first(x, annotation) : undefined;
  const params = type !== undefined ? typeArgumentsOf(x, type) : undefined;
  return (
    params !== undefined &&
    params.length > 1 &&
    params.some(
      (p) =>
        (typeArgumentsOf(x, p)?.length ?? 0) > 0 ||
        kind(x, p) === "conditional_type",
    )
  );
}

function typeArgumentsOf(x: HasTree, type: number): number[] | undefined {
  if (kind(x, type) !== "generic_type") return undefined;
  const args = field(x, type, "type_arguments");
  return args !== undefined ? items(x, args) : undefined;
}

function isComplexTypeAliasParams(x: HasTree, node: number): boolean {
  if (kind(x, node) !== "type_alias_declaration") return false;
  const params = field(x, node, "type_parameters");
  if (params === undefined) return false;
  const list = items(x, params);
  return (
    list.length > 1 &&
    list.some(
      (p) =>
        field(x, p, "constraint") !== undefined ||
        field(x, p, "value") !== undefined,
    )
  );
}

const isGenericType = (x: HasTree, n: number | undefined) =>
  (kind(x, n) === "generic_type" &&
    field(x, n as number, "type_arguments") !== undefined) ||
  (kind(x, n) === "function_type" &&
    field(x, n as number, "type_parameters") !== undefined);

function isObjectPropertyWithShortKey(
  ctx: JsCtx,
  node: number,
  keyPart: Part,
): boolean {
  if (!isObjectProperty(ctx, node)) return false;
  const key = flatText(keyPart);
  return key !== undefined && textWidth(key) < ctx.options.tabWidth + 3;
}
