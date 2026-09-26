import type {
  CommentContext,
  CommentHandler,
  CommentTarget,
} from "../../../fmt/comments.js";
import type { FormatNode } from "../../../fmt/tree.js";

// Prettier's handleComments for estree (language-js/comments/handle-comments.js), over tree-sitter's tree: each
// handler reads only node kinds and the tree's shape, and returns undefined when prettier's would return false.

const isCode = (n: FormatNode) => n.kind !== "comment";

/** The code children of `n` after `child`. */
const codeAfter = (n: FormatNode, child: FormatNode) =>
  n.children.slice(n.children.indexOf(child) + 1).filter(isCode);

const lastCode = (n: FormatNode) => n.children.findLast(isCode);

/**
 * A comment before a statement's closing `;` trails the whole statement: prettier's statement ends before the
 * comment (`const a = 1 /* c *\/;` prints `const a = 1; /* c *\/`).
 */
const beforeSemicolon = ({
  comment,
  enclosing,
  following,
}: CommentContext): CommentTarget | undefined => {
  if (following || enclosing.parent?.kind.startsWith("for")) return;
  const rest = codeAfter(enclosing, comment);
  if (rest.length !== 1 || rest[0]?.kind !== ";") return;
  let node = enclosing;
  while (node.parent?.parent && lastCode(node.parent) === node)
    node = node.parent;
  return { node, as: "trailing" };
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

const handlers = [beforeSemicolon, unionMember, methodName];

export const handleComment: CommentHandler = (c) => {
  for (const h of handlers) {
    const target = h(c);
    if (target) return target;
  }
  return undefined;
};
