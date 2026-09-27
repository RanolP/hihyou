import type {
  CommentContext,
  CommentHandler,
  CommentTarget,
} from "../../../fmt/comments.js";
import {
  children,
  fieldName,
  type HasTree,
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
const beforeSemicolon = (c: CommentContext): CommentTarget | undefined => {
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
const unionMember = (c: CommentContext): CommentTarget | undefined => {
  const { enclosing, preceding, placement } = c;
  if (
    kind(c, enclosing) !== "union_type" ||
    preceding === undefined ||
    placement === "remaining"
  )
    return;
  return { node: lastMember(c, preceding), as: "trailing" };
};

const METHODS = new Set(["method_definition", "method_signature"]);

/** `m /* c *\/ () {}`: the comment trails the method's name (handleMethodNameComments). */
const methodName = (c: CommentContext): CommentTarget | undefined => {
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

const TRY_PARTS = new Set(["try_statement", "catch_clause", "finally_clause"]);

/** `try /* c *\/ {}`: a comment before a try, catch or finally block moves into it (handleTryStatementComments). */
const tryBlock = (c: CommentContext): CommentTarget | undefined => {
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

// In prettier's order within each placement: conditional runs early, nestedConditional last.
const handlers = [
  conditional,
  beforeSemicolon,
  unionMember,
  methodName,
  tryBlock,
  nestedConditional,
];

export const handleComment: CommentHandler<JsOptions> = (c) => {
  for (const h of handlers) {
    const target = h(c);
    if (target) return target;
  }
  return undefined;
};
