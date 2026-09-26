import type {
  CommentContext,
  CommentHandler,
  CommentTarget,
} from "../../../fmt/comments.js";
import type { FormatNode } from "../../../fmt/tree.js";
import type { JsOptions } from "./util.js";

// Prettier's handleComments for estree (language-js/comments/handle-comments.js), over tree-sitter's tree: each
// handler reads only node kinds and the tree's shape, and returns undefined when prettier's would return false.

const isCode = (n: FormatNode) => n.kind !== "comment";

/** The code children of `n` after `child`. */
const codeAfter = (n: FormatNode, child: FormatNode) =>
  n.children.slice(n.children.indexOf(child) + 1).filter(isCode);

const lastCode = (n: FormatNode) => n.children.findLast(isCode);

/**
 * A comment before a statement's closing `;` sits between that statement and the next: prettier's statement ends
 * before the comment. On a line of its own it leads the next statement (`a\n// c\n;[]`), else it trails the
 * statement (`const a = 1 /* c *\/;` prints `const a = 1; /* c *\/`).
 */
const beforeSemicolon = ({
  comment,
  enclosing,
  following,
  placement,
}: CommentContext): CommentTarget | undefined => {
  // A `for` head's initializer is a statement, `;` and all.
  if (
    following ||
    (enclosing.parent?.kind.startsWith("for") && enclosing.field !== "body")
  )
    return;
  const rest = codeAfter(enclosing, comment);
  if (rest.length !== 1 || rest[0]?.kind !== ";") return;
  let node = enclosing;
  while (node.parent?.parent && lastCode(node.parent) === node)
    node = node.parent;
  const next =
    placement === "ownLine" && node.parent
      ? codeAfter(node.parent, node).find((n) => n.named)
      : undefined;
  return next ? { node: next, as: "leading" } : { node, as: "trailing" };
};

/** tree-sitter nests `A | B | C` as `(A | B) | C`; prettier's union is flat. */
const lastMember = (n: FormatNode): FormatNode => {
  let member = n;
  while (member.kind === "union_type") {
    const last = member.children.findLast((c) => c.named && isCode(c));
    if (!last) break;
    member = last;
  }
  return member;
};

/** A comment between union members trails the member before it (handleUnionTypeComments). */
const unionMember = ({
  enclosing,
  preceding,
  placement,
}: CommentContext): CommentTarget | undefined => {
  if (
    enclosing.kind !== "union_type" ||
    !preceding ||
    placement === "remaining"
  )
    return;
  return { node: lastMember(preceding), as: "trailing" };
};

const METHODS = new Set(["method_definition", "method_signature"]);

/** `m /* c *\/ () {}`: the comment trails the method's name (handleMethodNameComments). */
const methodName = ({
  enclosing,
  preceding,
  following,
}: CommentContext): CommentTarget | undefined => {
  if (!METHODS.has(enclosing.kind) || !preceding || !following) return;
  if (preceding.field !== "name" || following.field !== "parameters") return;
  return { node: preceding, as: "trailing" };
};

/** A block's first statement leads with the comment, or an empty block holds it (addBlockStatementFirstComment). */
const blockFirst = (block: FormatNode): CommentTarget => {
  const first = block.children.find(
    (n) => n.named && isCode(n) && n.kind !== "empty_statement",
  );
  return first
    ? { node: first, as: "leading" }
    : { node: block, as: "dangling" };
};

const TRY_PARTS = new Set(["try_statement", "catch_clause", "finally_clause"]);

/** `try /* c *\/ {}`: a comment before a try, catch or finally block moves into it (handleTryStatementComments). */
const tryBlock = ({
  enclosing,
  preceding,
  following,
  placement,
}: CommentContext): CommentTarget | undefined => {
  if (!TRY_PARTS.has(enclosing.kind) || !following || placement === "remaining")
    return;
  if (enclosing.kind === "catch_clause" && preceding)
    return { node: preceding, as: "trailing" };
  if (following.kind === "statement_block") return blockFirst(following);
  const body = following.kind.endsWith("_clause")
    ? following.children.findLast((n) => n.kind === "statement_block")
    : undefined;
  return body ? blockFirst(body) : undefined;
};

const CONDITIONALS = new Set(["ternary_expression", "conditional_type"]);

/**
 * A comment before a conditional's branch, off the line of the code before it, leads the branch; under
 * experimentalTernaries one before the alternate dangles on the conditional, which prints it after `:`, unless
 * it is a one-line block comment (handleConditionalExpressionComments). Off the line: `placement` stands in for
 * prettier's newline test between the preceding node and the comment, which it matches but for a comment that
 * ends a line after a token such as `?` that opened it.
 */
const conditional = ({
  text,
  enclosing,
  preceding,
  following,
  placement,
  options,
}: CommentContext<JsOptions>): CommentTarget | undefined => {
  if (placement === "remaining" || !CONDITIONALS.has(enclosing.kind)) return;
  if (!following || (preceding && placement !== "ownLine")) return;
  const oneLineBlock = text.startsWith("/*") && !text.includes("\n");
  return options.experimentalTernaries &&
    following.field === "alternative" &&
    !oneLineBlock
    ? { node: enclosing, as: "dangling" }
    : { node: following, as: "leading" };
};

/** Under experimentalTernaries, an own-line comment before a nested conditional dangles on its parent (handleNestedConditionalExpressionComments). */
const nestedConditional = ({
  enclosing,
  following,
  placement,
  options,
}: CommentContext<JsOptions>): CommentTarget | undefined => {
  if (placement !== "ownLine" || !options.experimentalTernaries) return;
  if (!CONDITIONALS.has(enclosing.kind) || !following) return;
  return CONDITIONALS.has(following.kind)
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
