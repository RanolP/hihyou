// Prettier's needs-parens.js (3.9.9) over tree-sitter's tree: whether an expression must be wrapped in
// parentheses where it stands. Source parentheses are a `parenthesized_expression` node, which prettier's AST
// does not have, so every question here looks through them to the node's real parent and role.

import { returnArgumentHasLeadingComment } from "./statements.js";
import {
  argument,
  callee,
  children,
  childWhere,
  field,
  fieldName,
  first,
  type HasTree,
  hasCommentThroughParens,
  isCall,
  isMember,
  isOptional,
  isTaggedTemplate,
  type JsCtx,
  kind,
  named,
  objectOf,
  outer,
  parent as parentOf,
  src,
  unassert,
  unparen,
} from "./util.js";

/** The node's real parent and the role it plays there, by prettier's key names. */
export interface Role {
  parent: number | undefined;
  key: string;
  /** The outermost parenthesized_expression wrapping the node, or the node. */
  top: number;
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
  for_in_statement: { right: "right", left: "left", value: "init" },
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

export function role(x: HasTree, n: number): Role {
  const top = outer(x, n);
  const parent = parentOf(x, top);
  if (parent === undefined) return { parent, key: "", top };
  const pk = kind(x, parent);
  const f = fieldName(x, top);
  const byField = f && FIELD_KEYS[pk]?.[f];
  if (byField) return { parent, key: byField, top };
  switch (pk) {
    case "arguments": {
      const call = parentOf(x, parent);
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
    case "instantiation_expression":
      return { parent, key: "expression", top };
    case "computed_property_name":
      return { parent, key: "key", top };
    case "extends_clause":
      return { parent, key: "superClass", top };
  }
  if (ARGUMENT_PARENTS.has(pk)) return { parent, key: "argument", top };
  return { parent, key: f ?? "", top };
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

export const operatorOf = (x: HasTree, n: number) => {
  const o = field(x, n, "operator");
  if (o !== undefined) return kind(x, o);
  if (kind(x, n) === "as_expression") return "as";
  if (kind(x, n) === "satisfies_expression") return "satisfies";
  return "";
};

const isBinaryish = (x: HasTree, n: number) =>
  kind(x, n) === "binary_expression";
const isLogical = (x: HasTree, n: number) =>
  kind(x, n) === "binary_expression" &&
  ["&&", "||", "??"].includes(operatorOf(x, n));
const isAsLike = (x: HasTree, n: number) =>
  kind(x, n) === "as_expression" || kind(x, n) === "satisfies_expression";

/** A prefix `++a`: the update_expression's first child is its operator. */
const isPrefix = (x: HasTree, n: number) =>
  x.tree.count(n) > 0 && fieldName(x, x.tree.child(n, 0)) === "operator";

/** Prettier's startsWithNoLookaheadToken walk: the leftmost node `n` begins with. */
function leftmostIs(
  x: HasTree,
  n: number | undefined,
  target: number,
): boolean {
  while (n !== undefined) {
    if (n === target) return true;
    switch (kind(x, n)) {
      case "parenthesized_expression":
        n = first(x, n);
        break;
      case "binary_expression":
      case "assignment_expression":
      case "augmented_assignment_expression":
        n = field(x, n, "left");
        break;
      case "member_expression":
      case "subscript_expression":
        n = objectOf(x, n);
        break;
      case "call_expression": {
        const c = callee(x, n);
        if (kind(x, unparen(x, c ?? n)) === "function_expression") return false;
        n = c;
        break;
      }
      case "ternary_expression":
        n = field(x, n, "condition");
        break;
      case "update_expression":
        if (isPrefix(x, n)) return false;
        n = field(x, n, "argument");
        break;
      case "sequence_expression":
        n = first(x, n);
        break;
      case "as_expression":
      case "satisfies_expression":
      case "non_null_expression":
        n = first(x, n);
        break;
      default:
        return false;
    }
  }
  return false;
}

function findAncestor(
  x: HasTree,
  n: number,
  test: (a: number) => boolean,
): number | undefined {
  for (let a = parentOf(x, n); a !== undefined; a = parentOf(x, a))
    if (test(a)) return a;
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
export function needsParens(n: number, ctx: JsCtx): boolean {
  const { parent, key, top } = role(ctx, n);
  if (parent === undefined) return false;
  const nk = kind(ctx, n);
  const pk = kind(ctx, parent);
  // A type cast's parentheses (the only ones `role` stops at) are all an expression needs.
  if (pk === "parenthesized_expression") return false;
  if (top !== n && isAwaitCallArguments(ctx, top)) return true;
  // Annex B's `for (var a = (b) in c)`: prettier wraps every initializer there.
  if (pk === "for_in_statement" && key === "init") return true;
  // `return (\n// comment\na, b\n)`: the statement's own parentheses already hold the argument.
  if (
    (pk === "return_statement" || pk === "throw_statement") &&
    returnArgumentHasLeadingComment(ctx, top)
  )
    return false;

  if (nk === "identifier") {
    // `for ((async) of x)`, `for ((let).a of x)` and `(let)[0] = 1` keep theirs.
    const text = src(ctx, n);
    if (
      key === "left" &&
      pk === "for_in_statement" &&
      kind(ctx, field(ctx, parent, "operator")) === "of" &&
      text === "async"
    )
      return (
        childWhere(
          ctx,
          parent,
          (c) => kind(ctx, c) === "await" && fieldName(ctx, c) === undefined,
        ) === undefined
      );
    if (text === "let") {
      const forIn = findAncestor(
        ctx,
        n,
        (a) => kind(ctx, a) === "for_in_statement",
      );
      if (forIn !== undefined && leftmostIs(ctx, field(ctx, forIn, "left"), n))
        return true;
      if (key === "object" && pk === "subscript_expression") {
        const statement = findAncestor(ctx, n, (a) => {
          const k = kind(ctx, a);
          return (
            k === "expression_statement" ||
            k === "for_statement" ||
            k === "for_in_statement"
          );
        });
        const head =
          statement === undefined
            ? undefined
            : kind(ctx, statement) === "expression_statement"
              ? first(ctx, statement)
              : kind(ctx, statement) === "for_statement"
                ? field(ctx, statement, "initializer")
                : field(ctx, statement, "left");
        if (leftmostIs(ctx, head, n)) return true;
      }
    }
    // `(type) satisfies never;`: a statement would read the name as a keyword.
    if (
      isAsLike(ctx, parent) &&
      unparen(ctx, first(ctx, parent) ?? parent) === n &&
      CAST_KEYWORDS.has(text)
    ) {
      let a: number | undefined = parent;
      while (
        a !== undefined &&
        (isAsLike(ctx, a) || kind(ctx, a) === "parenthesized_expression")
      )
        a = parentOf(ctx, a);
      return kind(ctx, a) === "expression_statement";
    }
    return false;
  }

  if (STATEMENT_EXPRESSION_KINDS.has(nk)) {
    const statement = findAncestor(
      ctx,
      n,
      (a) => kind(ctx, a) === "expression_statement",
    );
    if (statement !== undefined && leftmostIs(ctx, first(ctx, statement), n))
      return true;
  }
  if (nk === "object") {
    const arrow = findAncestor(
      ctx,
      n,
      (a) => kind(ctx, a) === "arrow_function",
    );
    const body = arrow === undefined ? undefined : field(ctx, arrow, "body");
    // A sequence or assignment body is printed inside its own parens, which already shield the object.
    const bodyKind = body === undefined ? undefined : kind(ctx, unparen(ctx, body));
    if (
      body !== undefined &&
      bodyKind !== "sequence_expression" &&
      bodyKind !== "assignment_expression" &&
      leftmostIs(ctx, body, n)
    )
      return true;
  }

  switch (pk) {
    case "class_heritage":
    case "extends_clause":
      if (key === "superClass") {
        // Prettier looks through non-null assertions: `extends ({}!)`.
        const base = unassert(ctx, n);
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
          ].includes(kind(ctx, base)) ||
          isTaggedTemplate(ctx, base) ||
          isDecoratedClass(ctx, base)
        )
          return true;
      }
      break;
    case "export_statement":
      if (key === "declaration") {
        if (EXPORT_WRAPPED.has(nk)) return top !== n;
        if (exportDefaultNeedsParens(ctx, n)) return true;
      }
      break;
    case "decorator":
      if (key === "expression" && !isDecoratorMemberish(ctx, n)) return true;
      break;
  }

  switch (nk) {
    case "update_expression":
    case "unary_expression":
      if (nk === "update_expression" && pk === "unary_expression") {
        const prefix = isPrefix(ctx, n);
        const op = operatorOf(ctx, n);
        const pop = operatorOf(ctx, parent);
        return (
          prefix &&
          ((op === "++" && pop === "+") || (op === "--" && pop === "-"))
        );
      }
      switch (pk) {
        case "unary_expression": {
          const op = operatorOf(ctx, n);
          return op === operatorOf(ctx, parent) && (op === "+" || op === "-");
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
            ((nk === "unary_expression" &&
              ["in", "instanceof"].includes(operatorOf(ctx, parent))) ||
              operatorOf(ctx, parent) === "**")
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
      if (nk === "binary_expression") {
        if (pk === "update_expression") return true;
        if (operatorOf(ctx, n) === "in" && inForInit(ctx, n)) return true;
      }
      return binaryishNeedsParens(n, parent, key, ctx);
    case "sequence_expression":
      return !inForHead(ctx, n);
    case "yield_expression":
    case "await_expression":
      if (
        nk === "yield_expression" &&
        (pk === "await_expression" || pk === "type_assertion")
      )
        return true;
      switch (pk) {
        case "unary_expression":
        case "spread_element":
        case "as_expression":
        case "satisfies_expression":
        case "non_null_expression":
        case "instantiation_expression":
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
      if (pk === "expression_statement") {
        const g = kind(ctx, parentOf(ctx, parent));
        // A string statement that is no directive would become one without its parens.
        return (
          (g === "program" || g === "statement_block") &&
          !(top === n && isDirective(ctx, parent))
        );
      }
      return false;
    case "number":
      return key === "object" && pk === "member_expression";
    case "assignment_expression":
    case "augmented_assignment_expression":
      return assignmentNeedsParens(ctx, n, parent, key);
    case "ternary_expression":
      switch (pk) {
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
          return (
            kind(ctx, parentOf(ctx, parent)) === "jsx_opening_element" || false
          );
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
      switch (pk) {
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
      switch (pk) {
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
      return pk === "new_expression" && key === "callee";
    case "call_expression":
    case "member_expression":
    case "subscript_expression":
    case "non_null_expression":
      if (optionalChainNeedsParens(ctx, n, parent, key)) return true;
      if (key === "callee" && pk === "new_expression") {
        for (let c: number | undefined = n; c !== undefined;) {
          const ck = kind(ctx, c);
          if (ck === "call_expression" && !isTaggedTemplate(ctx, c))
            return true;
          if (isMember(ctx, c)) c = objectOf(ctx, c);
          else if (isTaggedTemplate(ctx, c)) c = callee(ctx, c);
          else if (ck === "non_null_expression") c = first(ctx, c);
          // Prettier's AST has no parentheses to stop at, `new (a())!()` printing as `new (a()!)()`, except the
          // ChainExpression they keep: `new (a?.())!()`.
          else if (ck === "parenthesized_expression" && !isChain(ctx, first(ctx, c)))
            c = first(ctx, c);
          else return false;
        }
      }
      return false;
    case "jsx_element":
    case "jsx_self_closing_element":
      return (
        key === "callee" ||
        (key === "left" &&
          pk === "binary_expression" &&
          operatorOf(ctx, parent) === "<") ||
        (!(key === "declaration" && pk === "export_statement") &&
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
          ].includes(pk))
      );
    case "instantiation_expression":
      return key === "object" && isMember(ctx, parent);
  }
  return false;
}

/** Prettier's isPathInForStatementInitializer: any depth, even inside a function in the initializer. */
function inForInit(x: HasTree, n: number): boolean {
  for (
    let c = n, p = parentOf(x, c);
    p !== undefined;
    c = p, p = parentOf(x, c)
  )
    if (kind(x, p) === "for_statement" && fieldName(x, c) === "initializer")
      return true;
  return false;
}

function binaryishNeedsParens(
  n: number,
  parent: number,
  key: string,
  ctx: JsCtx,
): boolean {
  switch (kind(ctx, parent)) {
    case "as_expression":
    case "satisfies_expression":
      return !isAsLike(ctx, n);
    case "ternary_expression":
      return (
        isAsLike(ctx, n) || (isLogical(ctx, n) && operatorOf(ctx, n) === "??")
      );
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
      return !hasCommentThroughParens(ctx, n);
    case "member_expression":
    case "subscript_expression":
      return key === "object";
    case "assignment_expression":
    case "augmented_assignment_expression":
    case "assignment_pattern":
      return (
        key === "left" &&
        (kind(ctx, n) === "type_assertion" || isAsLike(ctx, n))
      );
    case "binary_expression": {
      if (!isBinaryish(ctx, n) && kind(ctx, n) !== "type_assertion")
        return true;
      if (isLogical(ctx, n) && isLogical(ctx, parent))
        return operatorOf(ctx, parent) !== operatorOf(ctx, n);
      const op = operatorOf(ctx, n);
      const po = operatorOf(ctx, parent);
      const np = precedence(op);
      const pp = precedence(po);
      // Prettier compares against an undefined precedence here, and every comparison comes out false.
      if (kind(ctx, n) === "type_assertion") return isBitwise(po);
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
  x: HasTree,
  n: number,
  parent: number,
  key: string,
): boolean {
  const pk = kind(x, parent);
  if (
    pk === "for_statement" &&
    (key === "update" || fieldName(x, outer(x, n)) === "initializer")
  )
    return false;
  if (pk === "expression_statement")
    return kind(x, unparen(x, field(x, n, "left") ?? n)) === "object_pattern";
  if (
    pk === "assignment_expression" ||
    pk === "augmented_assignment_expression"
  )
    return false;
  if (pk === "sequence_expression") {
    const g = parentOf(x, parent);
    if (kind(x, g) === "for_statement") return false;
  }
  // Prettier parenthesizes a computed key's assignment everywhere except a TS property signature's (`[x = ""]: T`).
  if (
    pk === "computed_property_name" &&
    kind(x, parentOf(x, parent)) === "property_signature"
  )
    return false;
  return true;
}

function optionalChainNeedsParens(
  x: HasTree,
  n: number,
  parent: number,
  key: string,
): boolean {
  // `(a?.b).c`: the parentheses end the chain, so they stay; tree-sitter shows them only in the source.
  const top = outer(x, n);
  if (top === n) return false;
  if (!isChain(x, n)) return false;
  // `(a?.b)?.c`: a `?.` link continues the chain, so it reads as `a?.b?.c` and the parentheses go.
  if (isOptional(x, parent) && key !== "quasi") return false;
  const pk = kind(x, parent);
  return (
    (key === "object" && isMember(x, parent)) ||
    (key === "callee" && pk !== "new_expression" && isCall(x, parent)) ||
    (key === "callee" && pk === "new_expression") ||
    pk === "non_null_expression" ||
    (key === "callee" && isTaggedTemplate(x, parent))
  );
}

const FUNCTION_SCOPES = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
]);
const NON_ASYNC_SCOPES = new Set([
  "field_definition",
  "public_field_definition",
  "class_static_block",
]);

/** Whether `await` at `n` is an operator, as babel reads it: in an async function or at a module's top level. */
export function awaitsHere(x: HasTree, n: number): boolean {
  for (let a = parentOf(x, n); a !== undefined; a = parentOf(x, a)) {
    const k = kind(x, a);
    if (FUNCTION_SCOPES.has(k))
      return childWhere(x, a, (c) => kind(x, c) === "async") !== undefined;
    if (NON_ASYNC_SCOPES.has(k)) return false;
  }
  return true;
}

/**
 * tree-sitter reads `await (x)` and `await (x).y` as await expressions wherever they stand. Outside an async
 * function babel reads a call of `await` instead: `await(x)` and `await(x).y`, whose parentheses stay.
 */
export const isAwaitCall = (x: HasTree, n: number): boolean =>
  kind(x, n) === "await_expression" &&
  awaitCallParen(x, n) !== undefined &&
  !awaitsHere(x, n);

/** The parenthesized_expression that starts await `n`'s argument: `(x)` in `await (x).y`. */
function awaitCallParen(x: HasTree, n: number): number | undefined {
  let y = argument(x, n);
  while (y !== undefined && kind(x, y) !== "parenthesized_expression")
    y = isMember(x, y) ? objectOf(x, y) : kind(x, y) === "call_expression" ? callee(x, y) : undefined;
  return y;
}

/** Whether `top`, a parenthesized_expression, is the argument list of a call of `await` that babel reads. */
function isAwaitCallArguments(x: HasTree, top: number): boolean {
  let a = parentOf(x, top);
  while (a !== undefined && (isMember(x, a) || kind(x, a) === "call_expression")) a = parentOf(x, a);
  return a !== undefined && isAwaitCall(x, a) && awaitCallParen(x, a) === top;
}

/** A class expression with decorators, which prettier parenthesizes as `(` indent(line, class) line `)`. */
export const isDecoratedClass = (x: HasTree, n: number): boolean =>
  kind(x, n) === "class" &&
  childWhere(x, n, (c) => kind(x, c) === "decorator") !== undefined;

/** Whether `y` is an optional chain, prettier's ChainExpression: a `?.` link somewhere down its callee/object path. */
function isChain(x: HasTree, y: number | undefined): boolean {
  while (y !== undefined) {
    if (isOptional(x, y)) return true;
    if (kind(x, y) === "non_null_expression") y = first(x, y);
    else if (isMember(x, y)) y = objectOf(x, y);
    else if (isCall(x, y)) y = callee(x, y);
    else return false;
  }
  return false;
}

function isDecoratorMemberish(x: HasTree, n: number): boolean {
  const simple = (y: number | undefined): boolean => {
    if (y === undefined) return false;
    if (kind(x, y) === "identifier") return true;
    if (kind(x, y) === "member_expression")
      return (
        !isOptional(x, y) &&
        kind(x, field(x, y, "property")) === "property_identifier" &&
        simple(objectOf(x, y))
      );
    return false;
  };
  return (
    simple(n) ||
    (kind(x, n) === "call_expression" &&
      !isOptional(x, n) &&
      !isTaggedTemplate(x, n) &&
      simple(callee(x, n)))
  );
}

function exportDefaultNeedsParens(x: JsCtx, n: number): boolean {
  if (kind(x, n) === "sequence_expression") return true;
  // `export default (function () {})()`: an expression that starts with a function or class.
  let y: number | undefined = n;
  while (y !== undefined) {
    const k = kind(x, y);
    if ((k === "function_expression" || k === "class") && y !== n) return true;
    switch (k) {
      case "call_expression":
        y = callee(x, y);
        break;
      case "member_expression":
      case "subscript_expression":
        y = objectOf(x, y);
        break;
      case "binary_expression":
      case "assignment_expression":
        y = field(x, y, "left");
        break;
      case "ternary_expression":
        y = field(x, y, "condition");
        break;
      case "as_expression":
      case "satisfies_expression":
      case "non_null_expression":
        y = first(x, y);
        break;
      case "parenthesized_expression":
        // Prettier's AST has no source parentheses; a pair needsParens keeps is enough on its own:
        // `export default (function () {})()`, but `export default (function () {}.toString())`.
        y = unparen(x, y);
        if (needsParens(y, x)) return false;
        break;
      default:
        y = undefined;
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

const inForHead = (x: HasTree, n: number) =>
  kind(x, parentOf(x, outer(x, n))) === "for_statement";

const FUNCTION_BODY_PARENTS = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "arrow_function",
  "method_definition",
]);

/** Whether expression statement `s` is a directive: a bare string among the first statements of a program or function body. */
export function isDirective(x: HasTree, s: number): boolean {
  const body = parentOf(x, s);
  if (body === undefined) return false;
  const fn = parentOf(x, body);
  if (
    kind(x, body) !== "program" &&
    !(
      kind(x, body) === "statement_block" &&
      fn !== undefined &&
      FUNCTION_BODY_PARENTS.has(kind(x, fn))
    )
  )
    return false;
  for (const c of children(x, body)) {
    const k = kind(x, c);
    if (!named(x, c) || k === "comment" || k === "hash_bang_line") continue;
    const e = k === "expression_statement" ? first(x, c) : undefined;
    if (kind(x, e) !== "string") return false;
    if (c === s) return true;
  }
  return false;
}
