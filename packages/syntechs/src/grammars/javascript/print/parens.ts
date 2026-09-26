// Prettier's needs-parens.js (3.9.9) over tree-sitter's tree: whether an expression must be wrapped in
// parentheses where it stands. Source parentheses are a `parenthesized_expression` node, which prettier's AST
// does not have, so every question here looks through them to the node's real parent and role.

import type { FormatNode } from "../../../fmt/tree.js";
import { returnArgumentHasLeadingComment } from "./statements.js";
import {
  argument,
  callee,
  field,
  first,
  hasComment,
  isCall,
  isMember,
  isOptionalChainToken,
  isTaggedTemplate,
  type JsCtx,
  objectOf,
  outer,
  src,
  unparen,
} from "./util.js";

/** The node's real parent and the role it plays there, by prettier's key names. */
export interface Role {
  parent: FormatNode | undefined;
  key: string;
  /** The outermost parenthesized_expression wrapping the node, or the node. */
  top: FormatNode;
}

const FIELD_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  call_expression: { function: "callee", arguments: "quasi" },
  new_expression: { constructor: "callee" },
  member_expression: { object: "object", property: "property" },
  subscript_expression: { object: "object", index: "property" },
  binary_expression: { left: "left", right: "right" },
  assignment_expression: { left: "left", right: "right" },
  augmented_assignment_expression: { left: "left", right: "right" },
  assignment_pattern: { left: "left", right: "right" },
  object_assignment_pattern: { left: "left", right: "right" },
  ternary_expression: {
    condition: "test",
    consequence: "consequent",
    alternative: "alternate",
  },
  conditional_type: {
    left: "checkType",
    right: "extendsType",
    consequence: "consequent",
    alternative: "alternate",
  },
  arrow_function: { body: "body" },
  variable_declarator: { value: "init", name: "id" },
  pair: { value: "value", key: "key" },
  unary_expression: { argument: "argument" },
  update_expression: { argument: "argument" },
  export_statement: { value: "declaration", declaration: "declaration" },
  for_in_statement: { right: "right", left: "left" },
  for_statement: { increment: "update", condition: "test" },
  public_field_definition: { value: "value" },
  field_definition: { value: "value" },
  instantiation_expression: { function: "expression" },
  if_statement: { condition: "test" },
  while_statement: { condition: "test" },
  do_statement: { condition: "test" },
  switch_statement: { value: "discriminant" },
  switch_case: { value: "test" },
  enum_assignment: { value: "initializer" },
  required_parameter: { value: "right" },
  optional_parameter: { value: "right" },
};

const ARGUMENT_PARENTS = new Set([
  "await_expression",
  "spread_element",
  "yield_expression",
  "return_statement",
  "throw_statement",
  "unary_expression",
]);

export function role(n: FormatNode): Role {
  const top = outer(n);
  const parent = top.parent;
  if (!parent) return { parent, key: "", top };
  const byField = top.field && FIELD_KEYS[parent.kind]?.[top.field];
  if (byField) return { parent, key: byField, top };
  switch (parent.kind) {
    case "arguments": {
      const call = parent.parent;
      return { parent: call, key: "arguments", top };
    }
    case "expression_statement":
      return { parent, key: "expression", top };
    case "sequence_expression":
    case "template_substitution":
      return { parent, key: "expressions", top };
    case "array":
      return { parent, key: "elements", top };
    case "class_heritage":
      return { parent, key: "superClass", top };
    case "decorator":
    case "as_expression":
    case "satisfies_expression":
    case "non_null_expression":
    case "type_assertion":
    case "jsx_expression":
      return { parent, key: "expression", top };
    case "computed_property_name":
      return { parent, key: "key", top };
    case "extends_clause":
      return { parent, key: "superClass", top };
  }
  if (ARGUMENT_PARENTS.has(parent.kind))
    return { parent, key: "argument", top };
  return { parent, key: top.field ?? "", top };
}

// Prettier's getPrecedence table (utils/index.js).
const PRECEDENCE = new Map<string, number>(
  [
    ["??"],
    ["||"],
    ["&&"],
    ["|"],
    ["^"],
    ["&"],
    ["==", "===", "!=", "!=="],
    ["<", ">", "<=", ">=", "in", "instanceof"],
    [">>", "<<", ">>>"],
    ["+", "-"],
    ["*", "/", "%"],
    ["**"],
  ].flatMap((ops, i) => ops.map((op): [string, number] => [op, i])),
);
export const precedence = (op: string) => PRECEDENCE.get(op) ?? -1;

const EQUALITY = new Set(["==", "!=", "===", "!=="]);
const MULTIPLICATIVE = new Set(["*", "/", "%"]);
const BITSHIFT = new Set([">>", ">>>", "<<"]);

/** Prettier's shouldFlatten: whether `a op1 b op2 c` prints as one chain rather than nested. */
export function shouldFlatten(parentOp: string, nodeOp: string): boolean {
  if (precedence(nodeOp) !== precedence(parentOp)) return false;
  if (parentOp === "**") return false;
  if (EQUALITY.has(parentOp) && EQUALITY.has(nodeOp)) return false;
  if (
    (nodeOp === "%" && MULTIPLICATIVE.has(parentOp)) ||
    (parentOp === "%" && MULTIPLICATIVE.has(nodeOp))
  )
    return false;
  if (
    nodeOp !== parentOp &&
    MULTIPLICATIVE.has(nodeOp) &&
    MULTIPLICATIVE.has(parentOp)
  )
    return false;
  if (BITSHIFT.has(parentOp) && BITSHIFT.has(nodeOp)) return false;
  return true;
}

const isBitwise = (op: string) =>
  BITSHIFT.has(op) || op === "|" || op === "^" || op === "&";

export const operatorOf = (n: FormatNode) => {
  const o = field(n, "operator");
  if (o) return o.kind;
  if (n.kind === "as_expression") return "as";
  if (n.kind === "satisfies_expression") return "satisfies";
  return "";
};

const isBinaryish = (n: FormatNode) => n.kind === "binary_expression";
const isLogical = (n: FormatNode) =>
  n.kind === "binary_expression" && ["&&", "||", "??"].includes(operatorOf(n));
const isAsLike = (n: FormatNode) =>
  n.kind === "as_expression" || n.kind === "satisfies_expression";

/** Prettier's startsWithNoLookaheadToken walk: the leftmost node `n` begins with. */
function leftmostIs(n: FormatNode | undefined, target: FormatNode): boolean {
  while (n) {
    if (n === target) return true;
    switch (n.kind) {
      case "parenthesized_expression":
        n = first(n);
        break;
      case "binary_expression":
      case "assignment_expression":
      case "augmented_assignment_expression":
        n = field(n, "left");
        break;
      case "member_expression":
      case "subscript_expression":
        n = objectOf(n);
        break;
      case "call_expression": {
        const c = callee(n);
        if (unparen(c ?? n).kind === "function_expression") return false;
        n = c;
        break;
      }
      case "ternary_expression":
        n = field(n, "condition");
        break;
      case "update_expression":
        if (n.children[0]?.field === "operator") return false;
        n = field(n, "argument");
        break;
      case "sequence_expression":
        n = first(n);
        break;
      case "as_expression":
      case "satisfies_expression":
      case "non_null_expression":
        n = first(n);
        break;
      default:
        return false;
    }
  }
  return false;
}

function findAncestor(
  n: FormatNode,
  test: (a: FormatNode) => boolean,
): FormatNode | undefined {
  for (let a = n.parent; a; a = a.parent) if (test(a)) return a;
  return undefined;
}

const CAST_KEYWORDS = new Set([
  "await",
  "interface",
  "module",
  "using",
  "yield",
  "let",
  "component",
  "hook",
  "type",
]);

const STATEMENT_EXPRESSION_KINDS = new Set([
  "object",
  "function_expression",
  "generator_function",
  "class",
]);

/** Whether prettier wraps expression `n` (never a parenthesized_expression itself) in parentheses. */
export function needsParens(n: FormatNode, ctx: JsCtx): boolean {
  const { parent, key, top } = role(n);
  if (!parent) return false;
  // `return (\n// comment\na, b\n)`: the statement's own parentheses already hold the argument.
  if (
    (parent.kind === "return_statement" || parent.kind === "throw_statement") &&
    returnArgumentHasLeadingComment(ctx, top)
  )
    return false;

  if (n.kind === "identifier") {
    // `for ((async) of x)`, `for ((let).a of x)` and `(let)[0] = 1` keep theirs.
    const length = n.end - n.start;
    if (
      key === "left" &&
      parent.kind === "for_in_statement" &&
      field(parent, "operator")?.kind === "of" &&
      length === 5 &&
      src(ctx, n) === "async"
    )
      return !parent.children.some(
        (c) => c.kind === "await" && c.field === undefined,
      );
    if (length === 3 && src(ctx, n) === "let") {
      const forIn = findAncestor(n, (a) => a.kind === "for_in_statement");
      if (forIn && leftmostIs(field(forIn, "left"), n)) return true;
      if (key === "object" && parent.kind === "subscript_expression") {
        const statement = findAncestor(
          n,
          (a) =>
            a.kind === "expression_statement" ||
            a.kind === "for_statement" ||
            a.kind === "for_in_statement",
        );
        const head =
          statement?.kind === "expression_statement"
            ? first(statement)
            : statement?.kind === "for_statement"
              ? field(statement, "initializer")
              : statement && field(statement, "left");
        if (leftmostIs(head, n)) return true;
      }
    }
    // `(type) satisfies never;`: a statement would read the name as a keyword.
    if (
      isAsLike(parent) &&
      unparen(first(parent) ?? parent) === n &&
      CAST_KEYWORDS.has(src(ctx, n))
    ) {
      let a: FormatNode | undefined = parent;
      while (a && (isAsLike(a) || a.kind === "parenthesized_expression"))
        a = a.parent;
      return a?.kind === "expression_statement";
    }
    return false;
  }

  if (STATEMENT_EXPRESSION_KINDS.has(n.kind)) {
    const statement = findAncestor(n, (a) => a.kind === "expression_statement");
    if (statement && leftmostIs(first(statement), n)) return true;
  }
  if (n.kind === "object") {
    const arrow = findAncestor(n, (a) => a.kind === "arrow_function");
    const body = arrow && field(arrow, "body");
    if (
      body &&
      body.kind !== "sequence_expression" &&
      body.kind !== "assignment_expression" &&
      leftmostIs(body, n)
    )
      return true;
  }

  switch (parent.kind) {
    case "class_heritage":
    case "extends_clause":
      if (key === "superClass") {
        if (
          [
            "arrow_function",
            "assignment_expression",
            "augmented_assignment_expression",
            "await_expression",
            "binary_expression",
            "ternary_expression",
            "new_expression",
            "object",
            "sequence_expression",
            "unary_expression",
            "update_expression",
            "yield_expression",
          ].includes(n.kind) ||
          isTaggedTemplate(n)
        )
          return true;
      }
      break;
    case "export_statement":
      if (key === "declaration") {
        if (EXPORT_WRAPPED.has(n.kind)) return top !== n;
        if (exportDefaultNeedsParens(n)) return true;
      }
      break;
    case "decorator":
      if (key === "expression" && !isDecoratorMemberish(n)) return true;
      break;
  }

  switch (n.kind) {
    case "update_expression":
    case "unary_expression":
      if (
        n.kind === "update_expression" &&
        parent.kind === "unary_expression"
      ) {
        const prefix = n.children[0]?.field === "operator";
        const op = operatorOf(n);
        const pop = operatorOf(parent);
        return (
          prefix &&
          ((op === "++" && pop === "+") || (op === "--" && pop === "-"))
        );
      }
      switch (parent.kind) {
        case "unary_expression": {
          const op = operatorOf(n);
          return op === operatorOf(parent) && (op === "+" || op === "-");
        }
        case "member_expression":
        case "subscript_expression":
          return key === "object";
        case "call_expression":
          return key === "callee" || key === "quasi";
        case "new_expression":
          return key === "callee";
        case "binary_expression":
          return (
            key === "left" &&
            ((n.kind === "unary_expression" &&
              ["in", "instanceof"].includes(operatorOf(parent))) ||
              operatorOf(parent) === "**")
          );
        case "non_null_expression":
          return true;
        default:
          return false;
      }
    case "binary_expression":
    case "as_expression":
    case "satisfies_expression":
    case "type_assertion":
      if (n.kind === "binary_expression") {
        if (parent.kind === "update_expression") return true;
        if (operatorOf(n) === "in" && inForInit(n)) return true;
      }
      return binaryishNeedsParens(n, parent, key, ctx);
    case "sequence_expression":
      return !inForHead(n);
    case "yield_expression":
    case "await_expression":
      if (
        n.kind === "yield_expression" &&
        (parent.kind === "await_expression" || parent.kind === "type_assertion")
      )
        return true;
      switch (parent.kind) {
        case "unary_expression":
        case "spread_element":
        case "as_expression":
        case "satisfies_expression":
        case "non_null_expression":
          return true;
        case "binary_expression":
          return true;
        case "member_expression":
        case "subscript_expression":
          return key === "object";
        case "new_expression":
          return key === "callee";
        case "call_expression":
          return key === "callee" || key === "quasi";
        case "ternary_expression":
          return key === "test";
        default:
          return false;
      }
    case "string":
      if (parent.kind === "expression_statement") {
        const g = parent.parent;
        // A string statement that is no directive would become one without its parens.
        return (
          (g?.kind === "program" || g?.kind === "statement_block") &&
          !(top === n && isDirective(parent))
        );
      }
      return false;
    case "number":
      return key === "object" && parent.kind === "member_expression";
    case "assignment_expression":
    case "augmented_assignment_expression":
      return assignmentNeedsParens(n, parent, key);
    case "ternary_expression":
      switch (parent.kind) {
        case "unary_expression":
        case "spread_element":
        case "binary_expression":
        case "await_expression":
        case "as_expression":
        case "satisfies_expression":
        case "non_null_expression":
        case "type_assertion":
          return true;
        case "jsx_expression":
          return parent.parent?.kind === "jsx_opening_element" || false;
        case "new_expression":
          return key === "callee";
        case "call_expression":
          return key === "callee" || key === "quasi";
        case "ternary_expression":
          return key === "test" && !ctx.options.experimentalTernaries;
        case "member_expression":
        case "subscript_expression":
          return key === "object";
        default:
          return false;
      }
    case "function_expression":
    case "generator_function":
      switch (parent.kind) {
        case "call_expression":
          return key === "callee" || key === "quasi";
        case "new_expression":
          return key === "callee";
        case "export_statement":
          return false;
        default:
          return false;
      }
    case "arrow_function":
      switch (parent.kind) {
        case "binary_expression":
          return true;
        case "new_expression":
          return key === "callee";
        case "call_expression":
          return key === "callee" || key === "quasi";
        case "member_expression":
        case "subscript_expression":
          return key === "object";
        case "as_expression":
        case "satisfies_expression":
        case "non_null_expression":
        case "unary_expression":
        case "await_expression":
        case "type_assertion":
          return true;
        case "instantiation_expression":
          return key === "expression";
        case "ternary_expression":
          return key === "test";
        default:
          return false;
      }
    case "class":
      return parent.kind === "new_expression" && key === "callee";
    case "call_expression":
    case "member_expression":
    case "subscript_expression":
    case "non_null_expression":
      if (optionalChainNeedsParens(n, parent, key)) return true;
      if (key === "callee" && parent.kind === "new_expression") {
        for (let c: FormatNode | undefined = n; c; ) {
          if (c.kind === "call_expression" && !isTaggedTemplate(c)) return true;
          if (isMember(c)) c = objectOf(c);
          else if (isTaggedTemplate(c)) c = callee(c);
          else if (c.kind === "non_null_expression") c = first(c);
          else if (c.kind === "parenthesized_expression") return false;
          else return false;
        }
      }
      return false;
    case "jsx_element":
    case "jsx_self_closing_element":
      return (
        key === "callee" ||
        (key === "left" &&
          parent.kind === "binary_expression" &&
          operatorOf(parent) === "<") ||
        (!(key === "declaration" && parent.kind === "export_statement") &&
          ![
            "array",
            "arrow_function",
            "assignment_expression",
            "augmented_assignment_expression",
            "assignment_pattern",
            // TypeScript's parameter with a default value, babel-ts's AssignmentPattern.
            "required_parameter",
            "optional_parameter",
            "binary_expression",
            "ternary_expression",
            "expression_statement",
            "jsx_attribute",
            "jsx_element",
            "jsx_expression",
            "call_expression",
            "new_expression",
            "return_statement",
            "throw_statement",
            "variable_declarator",
            "yield_expression",
            "pair",
          ].includes(parent.kind))
      );
    case "instantiation_expression":
      return key === "object" && isMember(parent);
  }
  return false;
}

/** Prettier's isPathInForStatementInitializer: any depth, even inside a function in the initializer. */
function inForInit(n: FormatNode): boolean {
  for (let c: FormatNode | undefined = n; c?.parent; c = c.parent)
    if (c.parent.kind === "for_statement" && c.field === "initializer")
      return true;
  return false;
}

function binaryishNeedsParens(
  n: FormatNode,
  parent: FormatNode,
  key: string,
  ctx: JsCtx,
): boolean {
  switch (parent.kind) {
    case "as_expression":
    case "satisfies_expression":
      return !isAsLike(n);
    case "ternary_expression":
      return isAsLike(n) || (isLogical(n) && operatorOf(n) === "??");
    case "call_expression":
      return key === "callee" || key === "quasi";
    case "new_expression":
      return key === "callee";
    case "class_heritage":
    case "extends_clause":
      return key === "superClass";
    case "type_assertion":
    case "spread_element":
    case "await_expression":
    case "non_null_expression":
    case "update_expression":
      return true;
    case "unary_expression":
      // The unary printer parenthesizes and indents an argument that has comments itself.
      return !hasComment(ctx, n);
    case "member_expression":
    case "subscript_expression":
      return key === "object";
    case "assignment_expression":
    case "augmented_assignment_expression":
    case "assignment_pattern":
      return key === "left" && (n.kind === "type_assertion" || isAsLike(n));
    case "binary_expression": {
      if (!isBinaryish(n) && n.kind !== "type_assertion") return true;
      if (isLogical(n) && isLogical(parent))
        return operatorOf(parent) !== operatorOf(n);
      const op = operatorOf(n);
      const po = operatorOf(parent);
      const np = precedence(op);
      const pp = precedence(po);
      // Prettier compares against an undefined precedence here, and every comparison comes out false.
      if (n.kind === "type_assertion") return isBitwise(po);
      if (pp > np) return true;
      if (key === "right" && pp === np) return true;
      if (pp === np && !shouldFlatten(po, op)) return true;
      if (pp < np && op === "%" && (po === "+" || po === "-")) return true;
      if (isBitwise(po)) return true;
      return false;
    }
    default:
      return false;
  }
}

function assignmentNeedsParens(
  n: FormatNode,
  parent: FormatNode,
  key: string,
): boolean {
  if (
    parent.kind === "for_statement" &&
    (key === "update" || outer(n).field === "initializer")
  )
    return false;
  if (parent.kind === "expression_statement")
    return unparen(field(n, "left") ?? n).kind === "object_pattern";
  if (
    parent.kind === "assignment_expression" ||
    parent.kind === "augmented_assignment_expression"
  )
    return false;
  if (parent.kind === "sequence_expression") {
    const g = parent.parent;
    if (g?.kind === "for_statement") return false;
  }
  return true;
}

function optionalChainNeedsParens(
  n: FormatNode,
  parent: FormatNode,
  key: string,
): boolean {
  // `(a?.b).c`: the parentheses end the chain, so they stay; tree-sitter shows them only in the source.
  const top = outer(n);
  if (top === n) return false;
  const chained = (x: FormatNode | undefined): boolean => {
    while (x) {
      if (x.children.some(isOptionalChainToken)) return true;
      if (x.kind === "non_null_expression") x = first(x);
      else if (isMember(x)) x = objectOf(x);
      else if (isCall(x)) x = callee(x);
      else return false;
    }
    return false;
  };
  if (!chained(n)) return false;
  return (
    (key === "object" && isMember(parent)) ||
    (key === "callee" && parent.kind !== "new_expression" && isCall(parent)) ||
    (key === "callee" && parent.kind === "new_expression") ||
    parent.kind === "non_null_expression" ||
    (key === "quasi" && isTaggedTemplate(parent))
  );
}

function isDecoratorMemberish(n: FormatNode): boolean {
  const simple = (x: FormatNode | undefined): boolean => {
    if (!x) return false;
    if (x.kind === "identifier") return true;
    if (x.kind === "member_expression")
      return (
        !x.children.some(isOptionalChainToken) &&
        field(x, "property")?.kind === "property_identifier" &&
        simple(objectOf(x))
      );
    return false;
  };
  return (
    simple(n) ||
    (n.kind === "call_expression" &&
      !n.children.some(isOptionalChainToken) &&
      simple(callee(n)))
  );
}

function exportDefaultNeedsParens(n: FormatNode): boolean {
  if (n.kind === "sequence_expression") return true;
  // `export default (function () {})()`: an expression that starts with a function or class.
  let x: FormatNode | undefined = n;
  while (x) {
    if ((x.kind === "function_expression" || x.kind === "class") && x !== n)
      return true;
    switch (x.kind) {
      case "call_expression":
        x = callee(x);
        break;
      case "member_expression":
      case "subscript_expression":
        x = objectOf(x);
        break;
      case "binary_expression":
      case "assignment_expression":
        x = field(x, "left");
        break;
      case "ternary_expression":
        x = field(x, "condition");
        break;
      case "as_expression":
      case "satisfies_expression":
      case "non_null_expression":
        x = first(x);
        break;
      default:
        x = undefined;
    }
  }
  return false;
}

export { argument };

const EXPORT_WRAPPED = new Set([
  "function_expression",
  "generator_function",
  "class",
]);

const inForHead = (n: FormatNode) => outer(n).parent?.kind === "for_statement";

const FUNCTION_BODY_PARENTS = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
]);

/** Whether expression statement `s` is a directive: a bare string among the first statements of a program or function body. */
export function isDirective(s: FormatNode): boolean {
  const body = s.parent;
  if (!body) return false;
  if (
    body.kind !== "program" &&
    !(
      body.kind === "statement_block" &&
      body.parent &&
      FUNCTION_BODY_PARENTS.has(body.parent.kind)
    )
  )
    return false;
  for (const c of body.children) {
    if (!c.named || c.kind === "comment" || c.kind === "hash_bang_line")
      continue;
    const e = c.kind === "expression_statement" ? first(c) : undefined;
    if (e?.kind !== "string") return false;
    if (c === s) return true;
  }
  return false;
}
