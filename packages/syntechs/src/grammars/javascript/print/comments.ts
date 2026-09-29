import type {
  CommentContext,
  CommentHandler,
  CommentTarget,
} from "../../../fmt/comments.js";
import { firstLeaf } from "../../../fmt/tree.js";
import { heritage } from "./classes.js";
import {
  children,
  field,
  fieldName,
  type HasTree,
  isTypeCastComment,
  type JsOptions,
  kind,
  lastChildWhere,
  named,
  parent,
} from "./util.js";

// Prettier's handleComments for estree (language-js/comments/handle-comments.js), over tree-sitter's tree: each
// handler reads only node kinds and the tree's shape, and returns undefined when prettier's would return false.

const isCode = (x: HasTree, n: number) => kind(x, n) !== "comment";

/** The code children of `n` after `child`. */
const codeAfter = (x: HasTree, n: number, child: number) => {
  const all = children(x, n);
  return all.slice(all.indexOf(child) + 1).filter((c) => isCode(x, c));
};

const lastCode = (x: HasTree, n: number) =>
  lastChildWhere(x, n, (c) => isCode(x, c));

/**
 * A comment before a statement's closing `;` sits between that statement and the next: prettier's statement ends
 * before the comment. On a line of its own it leads the next statement (`a\n// c\n;[]`), else it trails the
 * statement (`const a = 1 /* c *\/;` prints `const a = 1; /* c *\/`).
 */
const beforeSemicolon = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, following, placement } = c;
  // A `for` head's initializer is a statement, `;` and all.
  if (
    following !== undefined ||
    (kind(c, parent(c, enclosing))?.startsWith("for") &&
      fieldName(c, enclosing) !== "body")
  )
    return;
  const rest = codeAfter(c, enclosing, comment);
  if (rest.length !== 1 || kind(c, rest[0]) !== ";") return;
  let node = enclosing;
  for (
    let up = parent(c, node);
    up !== undefined && parent(c, up) !== undefined && lastCode(c, up) === node;
    up = parent(c, node)
  )
    node = up;
  const holder = parent(c, node);
  const next =
    placement === "ownLine" && holder !== undefined
      ? codeAfter(c, holder, node).find((n) => named(c, n))
      : undefined;
  return next !== undefined
    ? { node: next, as: "leading" }
    : { node, as: "trailing" };
};

/** tree-sitter nests `A | B | C` as `(A | B) | C`; prettier's union is flat. */
const lastMember = (x: HasTree, n: number): number => {
  let member = n;
  while (kind(x, member) === "union_type") {
    const last = lastChildWhere(x, member, (c) => named(x, c) && isCode(x, c));
    if (last === undefined) break;
    member = last;
  }
  return member;
};

/** A comment between union members trails the member before it (handleUnionTypeComments). */
const unionMember = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, placement } = c;
  if (
    kind(c, enclosing) !== "union_type" ||
    preceding === undefined ||
    placement === "remaining"
  )
    return;
  return { node: lastMember(c, preceding), as: "trailing" };
};

/**
 * `type A = // c` then the type on the next line: a comment after the alias's `=` leads its type, where the core
 * would trail it after the alias's name (prettier 3.9's handleVariableDeclaratorComments over a type alias).
 */
const typeAliasValue = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, following } = c;
  if (
    kind(c, enclosing) !== "type_alias_declaration" ||
    following === undefined ||
    fieldName(c, following) !== "value"
  )
    return;
  const kids = children(c, enclosing);
  const eq = kids.findIndex((k) => kind(c, k) === "=");
  return eq !== -1 && kids.indexOf(comment) > eq
    ? { node: following, as: "leading" }
    : undefined;
};

const METHODS = new Set(["method_definition", "method_signature"]);

/** `m /* c *\/ () {}`: the comment trails the method's name (handleMethodNameComments). */
const methodName = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following } = c;
  if (
    !METHODS.has(kind(c, enclosing)) ||
    preceding === undefined ||
    following === undefined
  )
    return;
  if (
    fieldName(c, preceding) !== "name" ||
    fieldName(c, following) !== "parameters"
  )
    return;
  return { node: preceding, as: "trailing" };
};

/** A block's first statement leads with the comment, or an empty block holds it (addBlockStatementFirstComment). */
const blockFirst = (x: HasTree, block: number): CommentTarget => {
  const first = children(x, block).find(
    (n) => named(x, n) && isCode(x, n) && kind(x, n) !== "empty_statement",
  );
  return first !== undefined
    ? { node: first, as: "leading" }
    : { node: block, as: "dangling" };
};

const FUNCTIONS = new Set([
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
]);

/**
 * `function f() // c` then `{` on the next line: a line comment between a function's parameters and its body moves
 * into the body (handleLastFunctionArgComments). An arrow keeps it before its body.
 */
const functionBody = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following, placement, text } = c;
  if (
    placement === "remaining" ||
    text.startsWith("/*") ||
    !FUNCTIONS.has(kind(c, enclosing)) ||
    following === undefined ||
    following !== field(c, enclosing, "body")
  )
    return;
  return blockFirst(c, following);
};

const HEAD_BODY = new Map([
  ["if_statement", "consequence"],
  ["while_statement", "body"],
  ["with_statement", "body"],
  ["for_statement", "body"],
  ["for_in_statement", "body"],
]);

/**
 * `if (a) // c` then the body on the next line: a comment after a statement's head leads its body, which prints it
 * before the body, `{` below it (handleIfStatementComments, handleWhileComments, handleForComments). The head's
 * parentheses are a node of their own in tree-sitter, except in a `for`, whose comments before `)` stay put.
 */
const statementBody = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, following, text, tree } = c;
  const body = HEAD_BODY.get(kind(c, enclosing));
  // Before `else`: a comment on the line of a non-block consequent trails it, any other dangles on the `if`,
  // which prints it between the consequent and `else`. tree-sitter puts one after `else` in the else_clause.
  if (
    kind(c, enclosing) === "if_statement" &&
    preceding !== undefined &&
    preceding === field(c, enclosing, "consequence") &&
    following === field(c, enclosing, "alternative")
  ) {
    const oneLine = text.startsWith("//") || !text.includes("\n");
    return kind(c, preceding) !== "statement_block" && oneLine && tree.lf(comment) === 0
      ? { node: preceding, as: "trailing" }
      : { node: enclosing, as: "dangling" };
  }
  if (body === undefined || following === undefined || following !== field(c, enclosing, body))
    return;
  const kids = children(c, enclosing);
  const close = kids.findLastIndex((k) => kind(c, k) === ")" && !named(c, k));
  return kids.indexOf(comment) > close ? { node: following, as: "leading" } : undefined;
};

const TRY_PARTS = new Set(["try_statement", "catch_clause", "finally_clause"]);

/** `try /* c *\/ {}`: a comment before a try, catch or finally block moves into it (handleTryStatementComments). */
const tryBlock = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following, placement } = c;
  if (
    !TRY_PARTS.has(kind(c, enclosing)) ||
    following === undefined ||
    placement === "remaining"
  )
    return;
  if (kind(c, enclosing) === "catch_clause" && preceding !== undefined)
    return { node: preceding, as: "trailing" };
  if (kind(c, following) === "statement_block") return blockFirst(c, following);
  const body = kind(c, following).endsWith("_clause")
    ? lastChildWhere(c, following, (n) => kind(c, n) === "statement_block")
    : undefined;
  return body !== undefined ? blockFirst(c, body) : undefined;
};

const CLASS_LIKE = new Set([
  "class",
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
]);
// tree-sitter's wrappers around a class's `extends` and `implements`, which prettier's AST has not: a comment
// in one is a comment in the class header.
const HERITAGE_PARTS = new Set([
  "class_heritage",
  "extends_clause",
  "implements_clause",
  "extends_type_clause",
]);

/**
 * A comment in a class or interface header (handleClassComments): with decorators it trails the last one; before
 * the body it moves into it; before the superclass or the first `implements`/`extends` type it trails the name,
 * type parameters or superclass before it, which the header prints, where the core would attach it to a
 * heritage wrapper the header never prints.
 */
const classHeader = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, following, placement, tree } = c;
  // Prettier runs this only for own-line and end-of-line comments. One between code on its line before a
  // wrapper (`class A /* c */ extends B`) has the keyword between it and the superclass, so prettier's tie-break
  // trails it after the name, where the core's would lead the wrapper.
  if (placement === "remaining")
    return preceding !== undefined &&
      following !== undefined &&
      HERITAGE_PARTS.has(kind(c, following))
      ? { node: preceding, as: "trailing" }
      : undefined;
  let cls: number | undefined = enclosing;
  while (cls !== undefined && HERITAGE_PARTS.has(kind(c, cls)))
    cls = parent(c, cls);
  if (cls === undefined || !CLASS_LIKE.has(kind(c, cls))) return;
  const decorators = children(c, cls).filter((n) => kind(c, n) === "decorator");
  if (
    decorators.length > 0 &&
    (following === undefined || kind(c, following) !== "decorator")
  )
    return { node: decorators.at(-1) as number, as: "trailing" };
  const body = field(c, cls, "body");
  if (body !== undefined && following === body) return blockFirst(c, body);
  const before = (n: number) =>
    tree.ord(comment) < tree.ord(firstLeaf(tree, n));
  const after = (n: number | undefined) =>
    n !== undefined && tree.ord(comment) > tree.ord(n);
  const name = field(c, cls, "name");
  const typeParameters = field(c, cls, "type_parameters");
  const head = after(typeParameters)
    ? typeParameters
    : after(name)
      ? name
      : undefined;
  const { ext, superClass, implementsList } = heritage(c, cls);
  if (superClass !== undefined && before(superClass))
    return head !== undefined ? { node: head, as: "trailing" } : undefined;
  const first = implementsList[0];
  if (first === undefined || !before(first)) return;
  // The superclass prints with its type arguments, so a comment after those trails them.
  const superArgs =
    ext !== undefined ? field(c, ext, "type_arguments") : undefined;
  const trailed = after(superArgs)
    ? superArgs
    : after(superClass)
      ? superClass
      : head;
  return trailed !== undefined
    ? { node: trailed, as: "trailing" }
    : undefined;
};

const CONDITIONALS = new Set(["ternary_expression", "conditional_type"]);

/**
 * A comment before a conditional's branch, off the line of the code before it, leads the branch; under
 * experimentalTernaries one before the alternate dangles on the conditional, which prints it after `:`, unless
 * it is a one-line block comment (handleConditionalExpressionComments). Off the line: `placement` stands in for
 * prettier's newline test between the preceding node and the comment, which it matches but for a comment that
 * ends a line after a token such as `?` that opened it.
 */
const conditional = (
  c: CommentContext<JsOptions>,
): CommentTarget | undefined => {
  const { text, enclosing, preceding, following, placement, options } = c;
  if (placement === "remaining" || !CONDITIONALS.has(kind(c, enclosing)))
    return;
  if (
    following === undefined ||
    (preceding !== undefined && placement !== "ownLine")
  )
    return;
  const oneLineBlock = text.startsWith("/*") && !text.includes("\n");
  return options.experimentalTernaries &&
    fieldName(c, following) === "alternative" &&
    !oneLineBlock
    ? { node: enclosing, as: "dangling" }
    : { node: following, as: "leading" };
};

/** Under experimentalTernaries, an own-line comment before a nested conditional dangles on its parent (handleNestedConditionalExpressionComments). */
const nestedConditional = (
  c: CommentContext<JsOptions>,
): CommentTarget | undefined => {
  const { enclosing, following, placement, options } = c;
  if (placement !== "ownLine" || !options.experimentalTernaries) return;
  if (!CONDITIONALS.has(kind(c, enclosing)) || following === undefined) return;
  return CONDITIONALS.has(kind(c, following))
    ? { node: enclosing, as: "dangling" }
    : undefined;
};

/** A type cast comment ending its line leads what follows it, the expression it casts (handleTypeCastComments). */
const typeCast = (c: CommentContext<JsOptions>): CommentTarget | undefined =>
  c.placement === "endOfLine" && c.following !== undefined && isTypeCastComment(c, c.comment)
    ? { node: c.following, as: "leading" }
    : undefined;

const DECLARATORS = new Set([
  "variable_declarator",
  "assignment_expression",
  "augmented_assignment_expression",
  "type_alias_declaration",
]);
const LITERAL_VALUES = new Set(["object", "array", "template_string", "object_type"]);

/**
 * `const a = /* c *\/⏎ value`: a comment ending the line after `=` leads the value when it is a block comment or
 * the value is an object, array or template literal (handleVariableDeclaratorComments).
 */
const declaratorValue = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following, placement } = c;
  if (placement !== "endOfLine" || following === undefined || !DECLARATORS.has(kind(c, enclosing)))
    return;
  const tagged =
    kind(c, following) === "call_expression" &&
    kind(c, field(c, following, "arguments")) === "template_string";
  return LITERAL_VALUES.has(kind(c, following)) || tagged || c.text.startsWith("/*")
    ? { node: following, as: "leading" }
    : undefined;
};

/**
 * `from "a" /* c *\/ with /* c *\/ {}` or `with { /* c *\/ }`: prettier's attributes are a bare list with no node
 * around `with` and `{}`, so a comment beside the keyword or in an empty `{}` trails the source, before `with`.
 */
const importAttribute = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following } = c;
  const inObject = kind(c, enclosing) === "object";
  const attribute = inObject ? parent(c, enclosing) : enclosing;
  let statement: number | undefined;
  if (following !== undefined && kind(c, following) === "import_attribute")
    statement = enclosing;
  else if (
    attribute !== undefined &&
    kind(c, attribute) === "import_attribute" &&
    !(inObject && (preceding !== undefined || following !== undefined))
  )
    statement = parent(c, attribute);
  const source = statement === undefined ? undefined : field(c, statement, "source");
  return source === undefined ? undefined : { node: source, as: "trailing" };
};

// In prettier's order within each placement: typeCast and conditional run early, nestedConditional last.
const handlers = [
  typeCast,
  importAttribute,
  conditional,
  beforeSemicolon,
  unionMember,
  typeAliasValue,
  methodName,
  functionBody,
  statementBody,
  tryBlock,
  classHeader,
  declaratorValue,
  nestedConditional,
];

export const handleComment: CommentHandler<JsOptions> = (c) => {
  for (const h of handlers) {
    const target = h(c);
    if (target) return target;
  }
  return undefined;
};
