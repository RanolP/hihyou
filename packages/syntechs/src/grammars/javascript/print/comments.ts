import type {
  CommentContext,
  CommentHandler,
  CommentTarget,
} from "../../../fmt/comments.js";
import { NO_NODE } from "../../../core/arena.js";
import { newlineBetween } from "../../../fmt/text.js";
import { firstLeaf, nextLeaf, prevLeaf } from "../../../fmt/tree.js";
import { heritage } from "./classes.js";
import { STATEMENT_LIST_PARENTS } from "./statements.js";
import { castGap, flattenTypes, mappedClauseOf, unparenType } from "./types.js";
import {
  callArguments,
  callee,
  children,
  field,
  fieldName,
  type HasTree,
  isCastParen,
  isIgnoreComment,
  isTypeCastComment,
  items,
  type JsOptions,
  kind,
  lastChildWhere,
  named,
  outer,
  parent,
  unparen,
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

/** Whether a line break stands between node `n` and the comment after it (prettier's hasNewlineInRange). */
const newlineAfter = (c: CommentContext<JsOptions>, n: number) => {
  const after = nextLeaf(c.tree, n);
  return c.tree.lf(after) > 0 || newlineBetween(c.tree, after, c.comment);
};

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

const JUMPS = new Set(["break_statement", "continue_statement", "debugger_statement"]);

/** The outermost statement that ends where `n` does, `n` itself at a statement list. */
const outermostEnding = (c: CommentContext<JsOptions>, n: number): number => {
  let node = n;
  for (
    let up = parent(c, node);
    up !== undefined && parent(c, up) !== undefined && lastCode(c, up) === node;
    up = parent(c, node)
  )
    node = up;
  return node;
};

/**
 * `for (;;) continue // c\n;`: oxfmt ends a `break`, `continue` or `debugger` at its `;`, so a comment before the
 * `;` on the statement's line trails it, breaking a loop's head from its body, and one on a line of its own trails
 * the outermost statement ending there, below it. tree-sitter ends the jump before a same-line `//` comment and
 * reads the `;` as an empty statement of its own.
 */
const oxfmtJumpSemicolon = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, following, tree } = c;
  if (c.options.compat !== "oxfmt") return;
  if (JUMPS.has(kind(c, enclosing))) {
    const rest = codeAfter(c, enclosing, comment);
    const semi = rest[0];
    if (rest.length !== 1 || semi === undefined || kind(c, semi) !== ";") return;
    if (tree.lf(comment) === 0) return { node: enclosing, as: "trailing" };
    // `continue⏎// c⏎;[]`: a `;` guarding the code after it leaves the comment to lead that code.
    const after = nextLeaf(tree, semi);
    return after === NO_NODE || tree.lf(after) > 0 ? { node: outermostEnding(c, enclosing), as: "trailing" } : undefined;
  }
  if (preceding === undefined || kind(c, following) !== "empty_statement" || tree.lf(comment) > 0) return;
  let jump: number | undefined = preceding;
  while (jump !== undefined && !JUMPS.has(kind(c, jump))) jump = lastCode(c, jump);
  return jump !== undefined && kind(c, lastCode(c, jump)) !== ";" ? { node: jump, as: "trailing" } : undefined;
};

/**
 * `for (x⏎// a⏎in y //b⏎)`: oxfmt's for-in/of head keeps no comment on a line of its own after the left side, but
 * hoists it above the `for`, and prints an end-of-line `//` comment after the right side, before the `)`.
 */
const oxfmtForInHead = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, text, tree } = c;
  if (c.options.compat !== "oxfmt" || kind(c, enclosing) !== "for_in_statement") return;
  const left = field(c, enclosing, "left");
  const right = field(c, enclosing, "right");
  if (left === undefined || right === undefined) return;
  const at = tree.ord(comment);
  const close = children(c, enclosing).findLast((k) => kind(c, k) === ")" && !named(c, k));
  if (at < tree.ord(left) || close === undefined || at > tree.ord(close)) return;
  if (tree.lf(comment) > 0 && at < tree.ord(right)) return { node: enclosing, as: "leading" };
  return text.startsWith("//") ? { node: right, as: "trailing" } : undefined;
};

const TYPE_BODIES = new Set(["object_type", "interface_body"]);
// Declarations whose TS AST range takes in their `;`, so a comment before it is inside them.
const SEMI_INSIDE = new Set(["type_alias_declaration", "function_signature"]);

/**
 * `type A = B /* c *\/;` and `{ a: B /* c *\/; }`: a block comment before the `;` of a type alias, an overload
 * signature, a type member or a class's index signature trails the type before it and prints before the `;`, since the TS AST's node for them
 * spans their `;`. After a signature's parameters, with no return type, or exported, where the export statement spans
 * the `;` instead, `beforeSemicolon` moves the comment past it.
 */
const typeBeforeSemicolon = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, text } = c;
  if (preceding === undefined || !text.startsWith("/*")) return;
  const all = children(c, enclosing);
  const next = all.slice(all.indexOf(comment) + 1).find((n) => isCode(c, n));
  if (next === undefined || kind(c, next) !== ";") return;
  if (
    TYPE_BODIES.has(kind(c, enclosing)) ||
    (kind(c, enclosing) === "class_body" && kind(c, preceding) === "index_signature")
  ) {
    const last = lastCode(c, preceding);
    return last !== undefined && named(c, last) && kind(c, last) !== "formal_parameters"
      ? { node: last, as: "trailing" }
      : undefined;
  }
  if (!SEMI_INSIDE.has(kind(c, enclosing)) || kind(c, preceding) === "formal_parameters") return;
  // oxfmt's type alias ends before its `;`, as a statement does.
  if (c.options.compat === "oxfmt" && kind(c, enclosing) === "type_alias_declaration") return;
  let up = parent(c, enclosing);
  if (up !== undefined && kind(c, up) === "ambient_declaration") up = parent(c, up);
  return up !== undefined && kind(c, up) === "export_statement"
    ? undefined
    : { node: preceding, as: "trailing" };
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
 * `/* c *\/ A | B`: a one-line block comment with only spaces between it and a union leads the union's first
 * member, so it prints after that member's `|` (prettier's shouldMoveCommentToFirstUnionMember).
 */
const unionHead = (c: CommentContext<JsOptions>, node: number): number => {
  if (c.options.compat === "oxfmt") return oxfmtUnionHead(c, node);
  if (kind(c, node) !== "union_type" || !c.text.startsWith("/*") || c.text.includes("\n")) return node;
  if (isIgnoreComment(c, c.comment)) return node;
  const head = firstLeaf(c.tree, node);
  if (c.tree.lf(head) > 0 || nextLeaf(c.tree, c.comment) !== head) return node;
  const { types } = flattenTypes(c, node);
  return types.length > 1 ? (types[0] as number) : node;
};

/**
 * oxfmt's form of unionHead: any block comment that does not end its line moves behind the first `|`, multi-line
 * ones too, and one before the `(`s and `|`s of parenthesized one-type unions reaches the union inside them.
 */
const oxfmtUnionHead = (c: CommentContext<JsOptions>, node: number): number => {
  const union = unparenType(c, node) ?? node;
  if (kind(c, union) !== "union_type" || !c.text.startsWith("/*") || isIgnoreComment(c, c.comment)) return node;
  const { types } = flattenTypes(c, union);
  const first = types[0];
  if (types.length < 2 || first === undefined) return node;
  let leaf = nextLeaf(c.tree, c.comment);
  if (c.tree.lf(leaf) > 0) return node;
  const head = firstLeaf(c.tree, first);
  for (; leaf !== head; leaf = nextLeaf(c.tree, leaf))
    if (kind(c, leaf) !== "(" && kind(c, leaf) !== "|") return node;
  return first;
};

/** `type A =⏎/* c *\/ A | B`: the comment before a union leads its first member (the last own-line handler). */
const firstUnionMember = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { following, placement } = c;
  if (placement === "endOfLine" || following === undefined) return;
  const head = unionHead(c, following);
  return head === following ? undefined : { node: head, as: "leading" };
};

const LAST_UNION_HOLDERS =new Set(["intersection_type", "union_type"]);

/**
 * `(A | B // c⏎)[]`, `& X` or `| X`: a comment ending the line after a union trails its last member, inside the
 * union's parentheses (handleLastUnionElementInExpression).
 */
/**
 * oxfmt: `(A | B // prettier-ignore⏎)`: an ignore comment right after a union keeps the whole union's source
 * (has_trailing_suppression_comment) and trails it.
 */
const oxfmtUnionIgnore = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  if (c.options.compat !== "oxfmt" || c.tree.lf(c.comment) > 0 || !isIgnoreComment(c, c.comment)) return;
  const before = prevLeaf(c.tree, c.comment);
  if (before === NO_NODE) return;
  let union: number | undefined;
  for (let n = before, up = parent(c, n); up !== undefined && lastCode(c, up) === n; n = up, up = parent(c, up)) {
    if (kind(c, up) === "union_type") union = up;
    else if (union !== undefined) break;
  }
  return union === undefined ? undefined : { node: union, as: "trailing" };
};

const lastUnionMember = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following, placement } = c;
  if (placement !== "endOfLine" || preceding === undefined) return;
  const union = unparenType(c, preceding);
  if (union === undefined || kind(c, union) !== "union_type") return;
  const holder = kind(c, enclosing);
  if (!LAST_UNION_HOLDERS.has(holder) && !(holder === "array_type" && following === undefined)) return;
  return { node: lastMember(c, union), as: "trailing" };
};

/**
 * Prettier's AST has no node for a type's parentheses, so a comment inside them with only `(` or `)` on one side
 * has the parenthesized type's neighbours: `& (⏎// c⏎A | B)` leads the whole `(A | B)`, above its `(`.
 */
const outOfTypeParens = (c: CommentContext<JsOptions>): CommentContext<JsOptions> => {
  let hoisted = c;
  if (c.placement === "remaining") return c;
  for (;;) {
    const { enclosing, preceding, following } = hoisted;
    const up = parent(c, enclosing);
    if (
      kind(c, enclosing) !== "parenthesized_type" ||
      up === undefined ||
      (preceding === undefined) === (following === undefined)
    )
      return hoisted;
    const kids = children(c, up).filter((k) => named(c, k) && isCode(c, k));
    const i = kids.indexOf(enclosing);
    hoisted =
      preceding === undefined
        ? { ...hoisted, enclosing: up, preceding: kids[i - 1], following: enclosing }
        : { ...hoisted, enclosing: up, preceding: enclosing, following: kids[i + 1] };
  }
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
    ? { node: unionHead(c, following), as: "leading" }
    : undefined;
};

/**
 * `import a = require( // c⏎ "a")`: prettier's TSExternalModuleReference holds `require(...)`, so a comment after
 * its `(` leads the source, where the core would trail it after the name.
 */
const requireSource = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, following } = c;
  if (kind(c, enclosing) !== "import_require_clause" || following === undefined) return;
  const kids = children(c, enclosing);
  const paren = kids.findIndex((k) => kind(c, k) === "(");
  return paren !== -1 && kids.indexOf(comment) > paren ? { node: following, as: "leading" } : undefined;
};

const BOUNDS = new Set(["constraint", "default_type"]);

/**
 * `T extends // c⏎ X` or `T = // c⏎ X`: prettier's TSTypeParameter has no node around `extends X` or `= X`, so a comment
 * ending the line after the keyword trails what precedes it, the name or the constraint. Its line suffix then breaks
 * the bound's group and indents the type under it.
 */
const typeParameterBound = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, placement } = c;
  if (placement !== "endOfLine" || preceding !== undefined || !BOUNDS.has(kind(c, enclosing))) return;
  const holder = parent(c, enclosing);
  if (holder === undefined) return;
  const code = (n: number) => children(c, n).filter((k) => named(c, k) && isCode(c, k));
  const kids = code(holder);
  const before = kids[kids.indexOf(enclosing) - 1];
  if (before === undefined) return;
  // Prettier's constraint is the type itself, `extends` and all being TSTypeParameter's own.
  const node = kind(c, before) === "constraint" ? (code(before).at(-1) ?? before) : before;
  return { node, as: "trailing" };
};

const SIGNATURES = new Set([
  "method_signature",
  "function_signature",
  "call_signature",
  "construct_signature",
  "constructor_type",
  "function_type",
]);
const ARROW_TYPES = new Set(["constructor_type", "function_type"]);

/**
 * `a /* c *\/ (x): T`, `new /* c *\/ (): T`: prettier's signature holds its parameters directly, so a comment before
 * the `(` has the first parameter, or else the return type, as its following node. With no node before it, it
 * leads that node (`new (/* c *\/ x)`, `new () /* c *\/ : T`); on one line after the name, it ties, and leads that
 * node only when nothing but spaces and `(` stand between them (`a(/* c *\/ x)`, `a /* c *\/?(x)`). A class's
 * bodiless method is prettier's TSDeclareMethod, which methodName places.
 */
const beforeSignatureParameters = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, following, placement } = c;
  if (
    !SIGNATURES.has(kind(c, enclosing)) ||
    following === undefined ||
    fieldName(c, following) !== "parameters" ||
    (kind(c, enclosing) === "method_signature" && kind(c, parent(c, enclosing)) === "class_body")
  )
    return;
  const parameter = children(c, following).find((n) => named(c, n) && isCode(c, n));
  const next = parameter ?? codeAfter(c, enclosing, following).find((n) => named(c, n));
  // Prettier's return type of a function or constructor type starts at its `=>`, which a comment leading it
  // precedes: the comment trails the parameters.
  const lead = (): CommentTarget | undefined =>
    next === undefined
      ? undefined
      : parameter === undefined && ARROW_TYPES.has(kind(c, enclosing))
        ? { node: following, as: "trailing" }
        : { node: next, as: "leading" };
  if (preceding === undefined) return lead();
  if (placement !== "remaining") return;
  if (next === undefined) return { node: preceding, as: "trailing" };
  const end = firstLeaf(c.tree, next);
  for (let l = nextLeaf(c.tree, comment); l !== end; l = nextLeaf(c.tree, l))
    if (kind(c, l) !== "comment" && kind(c, l) !== "(") return { node: preceding, as: "trailing" };
  return lead();
};

/**
 * oxfmt: `a? /* c *\/ ()`, `new /* c *\/ ()`: a comment after a signature's `?` or `new` trails that token, where
 * prettier moves it past the name or into the parameters.
 */
const oxfmtSignatureToken = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  if (c.options.compat !== "oxfmt" || !SIGNATURES.has(kind(c, c.enclosing))) return;
  let before = prevLeaf(c.tree, c.comment);
  while (before !== NO_NODE && kind(c, before) === "comment") before = prevLeaf(c.tree, before);
  if (before === NO_NODE || parent(c, before) !== c.enclosing) return;
  const k = kind(c, before);
  return k === "?" || k === "new" ? { node: before, as: "trailing" } : undefined;
};

/**
 * oxfmt: `a: T /* c *\/`, `m() /* c *\/;`: a block comment ending an interface or type literal member prints
 * before the member's separator, where prettier's follows it.
 */
const oxfmtTypeMemberEnd = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, placement, text } = c;
  if (
    c.options.compat !== "oxfmt" ||
    !text.startsWith("/*") ||
    preceding === undefined ||
    placement === "ownLine" ||
    !TYPE_BODIES.has(kind(c, enclosing))
  )
    return;
  const next = codeAfter(c, enclosing, comment)[0];
  if (
    placement !== "endOfLine" &&
    next !== undefined &&
    ![";", ",", "}"].includes(kind(c, next))
  )
    return;
  const last = lastCode(c, preceding);
  return last !== undefined && named(c, last) ? { node: last, as: "trailing" } : undefined;
};

const METHODS = new Set([
  "method_definition",
  "method_signature",
  "abstract_method_signature",
  "function_declaration",
  "function_expression",
  "generator_function_declaration",
  "generator_function",
]);

/** `m /* c *\/ () {}`, `function f /* c *\/ () {}`: the comment trails the name (handleMethodNameComments). */
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

const FIELDS = new Set(["field_definition", "public_field_definition"]);
const PARAMETERS = new Set(["required_parameter", "optional_parameter"]);
const PARAMETER_MODIFIERS = new Set(["accessibility_modifier", "readonly", "override"]);

/** A parameter property (`private a`, `readonly a`): prettier's TSParameterProperty holds the decorators. */
const isParameterProperty = (c: CommentContext<JsOptions>) =>
  PARAMETERS.has(kind(c, c.enclosing)) &&
  children(c, c.enclosing).some((n) => PARAMETER_MODIFIERS.has(kind(c, n)));

/**
 * `@dec()\n// c\naccessor b;`: a comment after a field's decorators trails the last one, above the modifiers, as
 * classHeader does for a class's. tree-sitter hangs `@dec export class` decorators on the export, where prettier's
 * are the class's, so a comment after them trails the last one there too, above `export`.
 */
const fieldDecorator = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following, placement } = c;
  if (
    placement === "remaining" ||
    !(
      FIELDS.has(kind(c, enclosing)) ||
      isParameterProperty(c) ||
      kind(c, enclosing) === "export_statement"
    ) ||
    preceding === undefined ||
    kind(c, preceding) !== "decorator" ||
    (following !== undefined && kind(c, following) === "decorator")
  )
    return;
  return { node: preceding, as: "trailing" };
};

/**
 * `@dec /* c *\/ async m() {}`: prettier's method starts at its key, so a comment with a modifier between it and the
 * key trails the decorator, inside the decorators' group, where a comment spanning lines breaks the line after it.
 */
const methodDecorator = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following, placement } = c;
  if (
    placement !== "remaining" ||
    kind(c, enclosing) !== "class_body" ||
    preceding === undefined ||
    kind(c, preceding) !== "decorator" ||
    following === undefined ||
    kind(c, following) !== "method_definition"
  )
    return;
  const name = field(c, following, "name");
  return name !== undefined && firstLeaf(c.tree, following) !== firstLeaf(c.tree, name)
    ? { node: preceding, as: "trailing" }
    : undefined;
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

/**
 * A comment between a head and its block: prettier moves it into the block, oxfmt keeps it before the `{`, with
 * the line breaks around it.
 */
const intoBlock = (c: CommentContext<JsOptions>, block: number): CommentTarget =>
  c.options.compat === "oxfmt" ? { node: block, as: "leading" } : blockFirst(c, block);

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
    (text.startsWith("/*") && c.options.compat !== "oxfmt") ||
    !FUNCTIONS.has(kind(c, enclosing)) ||
    following === undefined ||
    following !== field(c, enclosing, "body")
  )
    return;
  return intoBlock(c, following);
};

/**
 * `(a): T => // c` then the body: a comment after `=>` leads the body, where the core would trail the parameters
 * or the return type, as prettier's own arrow body handler does.
 */
const arrowBody = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, following } = c;
  if (
    kind(c, enclosing) !== "arrow_function" ||
    preceding === undefined ||
    following === undefined ||
    following !== field(c, enclosing, "body")
  )
    return;
  const kids = children(c, enclosing);
  const arrow = kids.findIndex((k) => kind(c, k) === "=>");
  if (arrow === -1 || kids.indexOf(comment) < arrow) return;
  // `=> // c` then `{` on the next line: the comment moves into the block, keeping the `{` on the arrow's line.
  return c.placement === "endOfLine" && kind(c, following) === "statement_block"
    ? intoBlock(c, following)
    : { node: following, as: "leading" };
};

const CALLS = new Set(["call_expression", "new_expression"]);

/**
 * `f⏎// c⏎()` or `f?./* c *\/()`: prettier's arguments are a bare list, so a comment before the `(` trails the
 * callee, but on a line of its own leads the first argument there is.
 */
const beforeArguments = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following, placement } = c;
  if (
    !CALLS.has(kind(c, enclosing)) ||
    preceding === undefined ||
    following === undefined ||
    !(
      (following === field(c, enclosing, "arguments") && kind(c, following) === "arguments") ||
      kind(c, following) === "optional_chain"
    )
  )
    return;
  const first = callArguments(c, enclosing)[0];
  // After `f<T>` the type arguments precede the comment in prettier's AST too, so its own defaults apply.
  if (kind(c, preceding) === "type_arguments")
    return placement !== "endOfLine" && first !== undefined
      ? { node: first, as: "leading" }
      : { node: preceding, as: "trailing" };
  if (placement === "ownLine" && first !== undefined) return { node: first, as: "leading" };
  const fn = callee(c, enclosing);
  return fn === undefined ? undefined : { node: fn, as: "trailing" };
};

const AS_EXPRESSIONS = new Set(["as_expression", "satisfies_expression"]);

/**
 * The comments between a cast's expression and its type, under oxfmt, in castGap's slots: the glued run trails the
 * expression, the cast holds the run after the operator, and the rest leads the type (or the cast, for `as const`).
 */
const oxfmtCast = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  if (c.options.compat !== "oxfmt") return;
  let n: number | undefined = c.enclosing;
  while (n !== undefined && kind(c, n) === "parenthesized_expression") n = parent(c, n);
  if (n === undefined || !AS_EXPRESSIONS.has(kind(c, n))) return;
  const gap = castGap(c, n);
  if (gap === undefined) return;
  const [expression, type] = items(c, n);
  if (expression !== undefined && gap.glued.includes(c.comment)) return { node: expression, as: "trailing" };
  if (gap.after.includes(c.comment)) return { node: n, as: "dangling" };
  if (gap.rest.includes(c.comment))
    return type !== undefined ? { node: type, as: "leading" } : { node: n, as: "dangling" };
  return;
};

/**
 * `1 as /*⏎c⏎*\/ Foo`: a block comment spanning lines after the expression leads the type, or trails the whole
 * expression after `as const`, whose `const` takes no comment, as prettier's handler for `as` and `satisfies` does.
 */
const asType = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following, text } = c;
  if (
    !AS_EXPRESSIONS.has(kind(c, enclosing)) ||
    !text.startsWith("/*") ||
    !text.includes("\n") ||
    preceding === undefined ||
    preceding !== children(c, enclosing).find((n) => named(c, n) && isCode(c, n))
  )
    return;
  return following !== undefined
    ? { node: following, as: "leading" }
    : { node: enclosing, as: "trailing" };
};

/**
 * `a: // c⏎B` in a type member: the TS AST's type annotation of a property signature starts at its type, not at the
 * `:`, so a comment ending the line after the `:` trails the key and prints after the member (`a: B; // c`).
 */
const propertySignatureColon = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, placement } = c;
  if (placement !== "endOfLine" || preceding !== undefined || kind(c, enclosing) !== "type_annotation") return;
  const signature = parent(c, enclosing);
  if (signature === undefined || kind(c, signature) !== "property_signature") return;
  const type = c.following;
  // oxfmt keeps it after the `:`, above any type.
  if (
    type !== undefined &&
    (c.options.compat === "oxfmt" || kind(c, type) === "union_type" || kind(c, type) === "intersection_type")
  )
    return { node: type, as: "leading" };
  const name = field(c, signature, "name");
  if (name === undefined) return;
  // `[k]: // c`: prettier's key is the expression inside the brackets.
  const key =
    kind(c, name) === "computed_property_name"
      ? children(c, name).find((n) => named(c, n) && isCode(c, n))
      : name;
  return key !== undefined ? { node: key, as: "trailing" } : undefined;
};

/** `a: // c` then the body: a comment in a labeled statement leads the statement (handleLabeledStatementComments). */
const labeled = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  if (c.placement === "remaining" || kind(c, c.enclosing) !== "labeled_statement") return;
  // oxfmt keeps one after the `:` there, before the body.
  const body = field(c, c.enclosing, "body");
  return c.options.compat === "oxfmt" && body !== undefined && c.following === body
    ? { node: body, as: "leading" }
    : { node: c.enclosing, as: "leading" };
};

/**
 * `default: // c` before the case's first statement: the comment dangles on the case, which prints it after the
 * `:`, but a line comment before a block moves into it (handleSwitchDefaultCaseComments).
 */
const switchDefault = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following, placement, text } = c;
  if (
    placement === "ownLine" ||
    kind(c, enclosing) !== "switch_default" ||
    following === undefined ||
    following !== children(c, enclosing).find((n) => named(c, n) && isCode(c, n))
  )
    return;
  return kind(c, following) === "statement_block" && (text.startsWith("//") || c.options.compat === "oxfmt")
    ? intoBlock(c, following)
    : { node: enclosing, as: "dangling" };
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
    // oxfmt prints every one of them between the `if` group and `else`, a same-line run trailing the group.
    return kind(c, preceding) !== "statement_block" && oneLine && tree.lf(comment) === 0 && c.options.compat !== "oxfmt"
      ? { node: preceding, as: "trailing" }
      : { node: enclosing, as: "dangling" };
  }
  if (body === undefined || following === undefined || following !== field(c, enclosing, body))
    return;
  const kids = children(c, enclosing);
  const close = kids.findLastIndex((k) => kind(c, k) === ")" && !named(c, k));
  return kids.indexOf(comment) > close ? { node: following, as: "leading" } : undefined;
};

/**
 * `switch (a) // c\n{}`: babel's switch has no node between the discriminant and the cases, so a comment after `)`
 * trails the discriminant, inside the parentheses, unless it sits on its own line above a first case, which it leads.
 */
const switchHead = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following, placement } = c;
  if (
    kind(c, enclosing) !== "switch_statement" ||
    preceding === undefined ||
    preceding !== field(c, enclosing, "value") ||
    following === undefined ||
    following !== field(c, enclosing, "body")
  )
    return;
  const firstCase = children(c, following).find((n) => named(c, n) && isCode(c, n));
  return placement === "ownLine" && firstCase !== undefined
    ? { node: firstCase, as: "leading" }
    : { node: unparen(c, preceding), as: "trailing" };
};

/**
 * `a; // b\n;// c`: prettier attaches no comment to an empty statement, so a comment beside a stray `;` in a
 * statement list takes the statements around it as neighbours, on a line of its own leading the next, else trailing
 * the one before.
 */
const besideEmptyStatement = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, following, placement } = c;
  const isStray = (n: number | undefined) => n !== undefined && kind(c, n) === "empty_statement";
  if (!STATEMENT_LIST_PARENTS.has(kind(c, enclosing)) || !(isStray(preceding) || isStray(following))) return;
  const kids = children(c, enclosing);
  const at = kids.indexOf(comment);
  const real = (n: number) => named(c, n) && isCode(c, n) && !isStray(n);
  const before = kids.slice(0, at).findLast(real);
  const after = kids.slice(at + 1).find(real);
  // Mid-line, the comment leads a statement right after it, with nothing but space between them.
  const touching = after !== undefined && nextLeaf(c.tree, comment) === firstLeaf(c.tree, after);
  if (before !== undefined && (placement === "endOfLine" || (placement === "remaining" && !touching) || after === undefined))
    return { node: before, as: "trailing" };
  return after === undefined ? { node: enclosing, as: "dangling" } : { node: after, as: "leading" };
};

/**
 * `for // c\n(;;);` or `for (a; /* c *\/;)`: an empty initializer or test is an empty_statement to tree-sitter and
 * nothing to babel, so a comment beside one takes babel's neighbours, the code around it with the empty parts
 * skipped, and prettier's attach places it there: before the body at the latest, else after the code before it,
 * since a `;` or `)` stands between the comment and whatever follows.
 */
const forEmptyPart = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing, preceding, following, placement } = c;
  const isEmptyPart = (n: number | undefined) =>
    n !== undefined && kind(c, n) === "empty_statement" && fieldName(c, n) !== "body";
  if (kind(c, enclosing) !== "for_statement" || !(isEmptyPart(following) || isEmptyPart(preceding))) return;
  const kids = children(c, enclosing);
  const at = kids.indexOf(comment);
  const close = kids.findLastIndex((k) => kind(c, k) === ")" && !named(c, k));
  // After the `)`, statementBody leads the body.
  if (at > close) return;
  // oxfmt keeps each comment in its slot of the head, which prints it (write_for_head_slot).
  if (c.options.compat === "oxfmt" && at > kids.findIndex((k) => kind(c, k) === "(")) return { node: enclosing, as: "dangling" };
  const real = (n: number) => named(c, n) && isCode(c, n) && !isEmptyPart(n);
  let before = kids.slice(0, at).findLast(real);
  // A declaring initializer holds its `;`, which babel's does not: the comment trails its last declarator.
  if (before !== undefined && fieldName(c, before) === "initializer" && kind(c, lastCode(c, before)) === ";")
    before = lastChildWhere(c, before, (n) => named(c, n) && isCode(c, n));
  const after = kids.slice(at + 1).find(real);
  if (before !== undefined && (placement !== "ownLine" || after === undefined))
    return { node: before, as: "trailing" };
  return after === undefined ? undefined : { node: after, as: "leading" };
};

/**
 * `{ a as // c\nb }`: a comment inside an import or export specifier, ending its line or on one of its own, leads
 * it (handleImportSpecifierComments).
 */
const specifier = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const k = kind(c, c.enclosing);
  return c.placement !== "remaining" && (k === "import_specifier" || k === "export_specifier")
    ? { node: c.enclosing, as: "leading" }
    : undefined;
};

/**
 * `import /* c *\/ { /* d *\/ } from "a"`: prettier prints an import of an empty `{}` as `import {} from`, with every
 * comment ahead of the source after `from`, so each leads the source.
 */
const emptyImport = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { tree } = c;
  let imp: number | undefined = c.enclosing;
  while (imp !== undefined && IMPORT_PARTS.has(kind(c, imp))) imp = parent(c, imp);
  if (imp === undefined || kind(c, imp) !== "import_statement") return;
  const source = field(c, imp, "source");
  const clause = children(c, imp).find((n) => kind(c, n) === "import_clause");
  if (
    source === undefined ||
    clause === undefined ||
    tree.ord(c.comment) > tree.ord(firstLeaf(tree, source))
  )
    return;
  const code = (n: number) => children(c, n).filter((k) => named(c, k) && isCode(c, k));
  const [only, ...rest] = code(clause);
  return only !== undefined && rest.length === 0 && kind(c, only) === "named_imports" && code(only).length === 0
    ? { node: source, as: "leading" }
    : undefined;
};

const IMPORT_PARTS = new Set(["import_clause", "named_imports"]);

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
  if (kind(c, following) === "statement_block") return intoBlock(c, following);
  // oxfmt keeps one before `catch` or `finally` there.
  if (c.options.compat === "oxfmt" && kind(c, following).endsWith("_clause")) return { node: following, as: "leading" };
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
  if (body !== undefined && following === body) return intoBlock(c, body);
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
 * it is a one-line block comment (handleConditionalExpressionComments). Only an expression's: prettier checks
 * `alternate`, a field TSConditionalType lacks (its is `falseType`), so a conditional type's comment leads the branch. Off the line: a line break between the
 * preceding node and the comment, so `a⏎? // c⏎b` leads `b` though the comment ends the line of its `?`.
 */
const conditional = (
  c: CommentContext<JsOptions>,
): CommentTarget | undefined => {
  const { text, enclosing, preceding, following, placement, options } = c;
  if (placement === "remaining" || !CONDITIONALS.has(kind(c, enclosing)))
    return;
  if (
    following === undefined ||
    (preceding !== undefined && !newlineAfter(c, preceding))
  )
    return;
  const oneLineBlock = text.startsWith("/*") && !text.includes("\n");
  return options.experimentalTernaries &&
    kind(c, enclosing) === "ternary_expression" &&
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
    ? { node: unionHead(c, following), as: "leading" }
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

const ASSIGNMENT_PATTERNS = new Set(["assignment_pattern", "object_assignment_pattern"]);

/** `[a] =\n// c\nb` in a pattern: the comment leads the whole default, `// c\n[a] = b` (handleAssignmentPatternComments). */
const assignmentPattern = (c: CommentContext<JsOptions>): CommentTarget | undefined =>
  c.placement === "ownLine" && ASSIGNMENT_PATTERNS.has(kind(c, c.enclosing))
    ? { node: c.enclosing, as: "leading" }
    : undefined;

const MEMBERS = new Set(["member_expression", "subscript_expression"]);
const MEMBER_PROPERTIES = new Set(["property_identifier", "identifier"]);

/**
 * `a⏎// c⏎.b`, `?.b` or `[b]`: an own-line comment before a member's identifier leads the whole member, and a member chain
 * prints it before that lookup (handleMemberExpressionComments). Left to the core it would lead the property,
 * after the `.`, and would lead the `?.` token, which prints no comments. Prettier's `?.` is a flag, not a node, so
 * the property follows the comment there too.
 */
const memberProperty = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following } = c;
  if (c.placement !== "ownLine" || !MEMBERS.has(kind(c, enclosing)) || following === undefined) return;
  const property =
    kind(c, following) === "optional_chain"
      ? (field(c, enclosing, "property") ?? field(c, enclosing, "index"))
      : following;
  return property !== undefined && MEMBER_PROPERTIES.has(kind(c, property))
    ? { node: enclosing, as: "leading" }
    : undefined;
};

/**
 * `a && ( // c⏎b)`: prettier's AST has no parentheses, so a comment after an expression's `(` and before its code
 * sits between that expression and the node before it in the parent, and prettier places it there: this end-of-line
 * one trails `a`. The parent's handlers run on that view first.
 */
const afterOpenParen = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following, placement } = c;
  if (
    placement === "remaining" ||
    c.preceding !== undefined ||
    following === undefined ||
    kind(c, enclosing) !== "parenthesized_expression" ||
    isCastParen(c, enclosing)
  )
    return;
  const top = outer(c, enclosing);
  const holder = parent(c, top);
  // An arrow's body keeps it, as prettier's does.
  if (holder === undefined || kind(c, holder) === "arrow_function") return;
  const all = children(c, holder);
  const preceding = all
    .slice(0, all.indexOf(top))
    .findLast((n) => named(c, n) && isCode(c, n));
  if (preceding === undefined) return;
  const view = { ...c, enclosing: holder, preceding, following: unparen(c, following) };
  for (const h of handlers) {
    const target = h(view);
    if (target) return target;
  }
  return placement === "ownLine"
    ? { node: view.following, as: "leading" }
    : { node: preceding, as: "trailing" };
};

/**
 * `(a, b /* c *\/);`: a comment before the `)` of a statement's parenthesized expression trails the statement,
 * after its `;`, as one between the `)` and the `;` does.
 */
const beforeStatementCloseParen = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following } = c;
  if (
    preceding === undefined ||
    following !== undefined ||
    kind(c, enclosing) !== "parenthesized_expression" ||
    isCastParen(c, enclosing)
  )
    return;
  const top = outer(c, enclosing);
  const holder = parent(c, top);
  if (holder === undefined) return;
  if (kind(c, holder) === "expression_statement") return { node: holder, as: "trailing" };
  // `= (a, b /* c */)`: as prettier's handleOnlyComments does, an arrow's body, a declarator's value, a return's
  // argument or an assignment's right side keeps the comment on its sequence's last expression (or assignment's
  // right side), inside the parentheses that print around the sequence (or assignment).
  const role = kind(c, holder);
  const at = fieldName(c, top);
  if (
    !(
      (role === "arrow_function" && at === "body") ||
      (role === "variable_declarator" && at === "value") ||
      (role === "assignment_expression" && at === "right") ||
      role === "return_statement"
    )
  )
    return;
  const expr = unparen(c, preceding);
  const last =
    kind(c, expr) === "sequence_expression"
      ? children(c, expr).findLast((n) => named(c, n) && isCode(c, n))
      : kind(c, expr) === "assignment_expression"
        ? field(c, expr, "right")
        : undefined;
  return last !== undefined ? { node: last, as: "trailing" } : undefined;
};

/**
 * A mapped type is one node in prettier's AST, where tree-sitter nests an index signature and its clause in an
 * object type. A comment before its `[` (a `readonly` included) dangles on the mapped type (handleTSMappedTypeComments);
 * one after `[` and before the clause leads the key, and one after the clause, before the value's `:`, trails the
 * constraint (or the `as` type), the node before it in prettier's AST.
 */
const mappedTypeParts = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { comment, enclosing } = c;
  const object =
    kind(c, enclosing) === "index_signature" ? parent(c, enclosing) : enclosing;
  if (object === undefined || kind(c, object) !== "object_type") return;
  const mapped = mappedClauseOf(c, object);
  if (mapped === undefined) return;
  const { signature, clause } = mapped;
  if (enclosing === object)
    return c.following === signature ? { node: object, as: "dangling" } : undefined;
  const kids = children(c, signature);
  const at = kids.indexOf(comment);
  const bracket = kids.findIndex((k) => !named(c, k) && kind(c, k) === "[");
  const clauseAt = kids.indexOf(clause);
  if (at < bracket) return { node: object, as: "dangling" };
  if (at < clauseAt) {
    const key = field(c, clause, "name");
    return key !== undefined ? { node: key, as: "leading" } : undefined;
  }
  if (c.following !== undefined && kind(c, c.following) !== "type_annotation") return;
  const last = field(c, clause, "alias") ?? field(c, clause, "type");
  return last !== undefined ? { node: last, as: "trailing" } : undefined;
};

/**
 * `declare /* c *\/ namespace A {}`: prettier's `declare` is a flag of the declaration, so a comment after it is
 * inside the declaration, before its name, and prints there (`declare namespace /* c *\/ A {}`).
 */
const afterDeclare = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following } = c;
  if (kind(c, enclosing) !== "ambient_declaration" || preceding !== undefined || following === undefined)
    return;
  const name =
    field(c, following, "name") ??
    children(c, following).find((k) => kind(c, k) === "variable_declarator");
  return name !== undefined ? { node: name, as: "leading" } : undefined;
};

/**
 * `type A = // c` above the type: oxfmt keeps the line comment on the head's line, trailing what stands before the
 * `=`, where prettier leads the type with it. Above an object type it moves below `=` as prettier's does.
 */
const oxfmtTypeAliasHead = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following } = c;
  if (
    c.options.compat !== "oxfmt" ||
    c.placement !== "endOfLine" ||
    !c.text.startsWith("//") ||
    kind(c, enclosing) !== "type_alias_declaration" ||
    following === undefined ||
    kind(c, unparenType(c, following) ?? following) === "object_type"
  )
    return;
  const op = prevLeaf(c.tree, c.comment);
  if (kind(c, op) !== "=" || parent(c, op) !== enclosing) return;
  const kids = children(c, enclosing);
  const before = kids.slice(0, kids.indexOf(op)).findLast((k) => named(c, k) && isCode(c, k));
  return before !== undefined ? { node: before, as: "trailing" } : undefined;
};

/**
 * `return /* c *\/ (a, b)`: oxfmt prints a sequence argument's parentheses before its leading comments, so a block
 * comment after `return` or `throw` moves inside them, before the first expression: `return (/* c *\/ a, b)`.
 */
const oxfmtReturnSequence = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following, preceding } = c;
  if (
    c.options.compat !== "oxfmt" ||
    !c.text.startsWith("/*") ||
    preceding !== undefined ||
    following === undefined ||
    (kind(c, enclosing) !== "return_statement" && kind(c, enclosing) !== "throw_statement")
  )
    return;
  const seq = unparen(c, following);
  if (kind(c, seq) !== "sequence_expression") return;
  const head = children(c, seq).find((k) => named(c, k) && isCode(c, k));
  return head !== undefined ? { node: head, as: "leading" } : undefined;
};

/**
 * `(⏎// c⏎a.b()⏎).c.d()`: prettier's member chain prints the parenthesized call's leading comment before its
 * arguments; oxfmt prints it before the whole chain, so it leads the chain's head `a`.
 */
const oxfmtChainHead = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, following } = c;
  if (
    c.options.compat !== "oxfmt" ||
    c.placement !== "ownLine" ||
    c.preceding !== undefined ||
    following === undefined ||
    kind(c, enclosing) !== "parenthesized_expression" ||
    isCastParen(c, enclosing)
  )
    return;
  const top = outer(c, enclosing);
  const holder = parent(c, top);
  if (
    holder === undefined ||
    !((MEMBERS.has(kind(c, holder)) && field(c, holder, "object") === top) ||
      (CALLS.has(kind(c, holder)) && field(c, holder, "function") === top))
  )
    return;
  let head = following;
  for (;;) {
    const k = kind(c, head);
    const next = MEMBERS.has(k) ? field(c, head, "object") : CALLS.has(k) ? field(c, head, "function") : undefined;
    if (next === undefined) break;
    head = next;
  }
  return head !== following ? { node: head, as: "leading" } : undefined;
};

/**
 * `a // c⏎.b.c`: outside a member chain (a member access with no call), oxfmt prints a line comment after the
 * object past the whole access, `a.b.c; // c`, where prettier keeps it after the object.
 */
const oxfmtMemberObject = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding } = c;
  if (
    c.options.compat !== "oxfmt" ||
    !c.text.startsWith("//") ||
    c.following === undefined ||
    !MEMBERS.has(kind(c, enclosing)) ||
    preceding === undefined ||
    field(c, enclosing, "object") !== preceding
  )
    return;
  let node = enclosing;
  for (
    let up = parent(c, node);
    up !== undefined && MEMBERS.has(kind(c, up)) && field(c, up, "object") === node;
    up = parent(c, node)
  )
    node = up;
  const holder = parent(c, node);
  if (holder !== undefined && CALLS.has(kind(c, holder)) && field(c, holder, "function") === node) return;
  return { node, as: "trailing" };
};

/**
 * `new A( // c⏎b)`: oxfmt prints a comment that ends the line of a `new` expression's `(` after the constructor,
 * `new A(b); // c` and `new A /* c *\/(b)`, where a call's leads its first argument.
 */
const oxfmtNewOpenParen = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing } = c;
  if (
    c.options.compat !== "oxfmt" ||
    c.placement !== "endOfLine" ||
    c.preceding !== undefined ||
    c.following === undefined ||
    kind(c, enclosing) !== "arguments"
  )
    return;
  const holder = parent(c, enclosing);
  if (kind(c, holder) !== "new_expression" || field(c, holder as number, "arguments") !== enclosing) return;
  const ctor = field(c, holder as number, "constructor");
  return ctor !== undefined ? { node: ctor, as: "trailing" } : undefined;
};

/**
 * `f?./* c *\/()`: oxfmt keeps a comment after a call's `?.` inside its arguments, leading the first or, with none,
 * dangling there: `f?.(/* c *\/)`.
 */
const oxfmtAfterOptionalCall = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following } = c;
  if (
    c.options.compat !== "oxfmt" ||
    !CALLS.has(kind(c, enclosing)) ||
    preceding === undefined ||
    kind(c, preceding) !== "optional_chain" ||
    following === undefined ||
    following !== field(c, enclosing, "arguments") ||
    kind(c, following) !== "arguments"
  )
    return;
  const first = callArguments(c, enclosing)[0];
  return first !== undefined ? { node: first, as: "leading" } : { node: following, as: "dangling" };
};

/** `foo /* c *\/ (1)`: oxfmt moves a comment between a call's callee and its `(` in front of the first argument. */
const oxfmtBeforeCallArguments = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following } = c;
  if (
    c.options.compat !== "oxfmt" ||
    kind(c, enclosing) !== "call_expression" ||
    preceding === undefined ||
    preceding !== field(c, enclosing, "function") ||
    following === undefined ||
    following !== field(c, enclosing, "arguments") ||
    kind(c, following) !== "arguments"
  )
    return;
  const first = callArguments(c, enclosing)[0];
  return first !== undefined ? { node: first, as: "leading" } : undefined;
};

/** `((/* c *\/ a), b)`: oxfmt has no node for the parentheses around a sequence's first element, so a comment in them leads the sequence. */
const oxfmtSequenceHeadParen = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  const { enclosing, preceding, following } = c;
  if (
    c.options.compat !== "oxfmt" ||
    kind(c, enclosing) !== "parenthesized_expression" ||
    preceding !== undefined ||
    following === undefined
  )
    return;
  const seq = parent(c, enclosing);
  if (seq === undefined || kind(c, seq) !== "sequence_expression" || children(c, seq).find((n) => isCode(c, n)) !== enclosing) return;
  return { node: seq, as: "leading" };
};

// Where parentheses around a right-most value print nothing, so a comment inside them is past the value's end.
const BARE_RIGHT = new Set([
  "assignment_expression",
  "augmented_assignment_expression",
  "variable_declarator",
  "arrow_function",
]);
const ENDS_WITH_VALUE = new Set(["expression_statement", "lexical_declaration", "variable_declaration"]);

/**
 * `a = (b /* c *\/);`: oxfmt's AST has no parentheses, so a block comment before a dropped `)` that closes the
 * statement's last value comes after that value, and oxfmt prints it past the statement's `;`: `a = b; /* c *\/`.
 */
const oxfmtAfterDroppedParen = (c: CommentContext<JsOptions>): CommentTarget | undefined => {
  if (
    c.options.compat !== "oxfmt" ||
    !c.text.startsWith("/*") ||
    c.preceding === undefined ||
    c.following !== undefined
  )
    return;
  let close: number | undefined = nextLeaf(c.tree, c.comment);
  while (close !== undefined && kind(c, close) === "comment") close = nextLeaf(c.tree, close);
  const pe = close === undefined ? undefined : parent(c, close);
  if (
    kind(c, close) !== ")" ||
    pe === undefined ||
    kind(c, pe) !== "parenthesized_expression" ||
    isCastParen(c, pe)
  )
    return;
  let node = outer(c, pe);
  const holder = parent(c, node);
  if (
    holder === undefined ||
    !BARE_RIGHT.has(kind(c, holder)) ||
    lastCode(c, holder) !== node ||
    // Parentheses that print again keep it: `x = (a, b /* c */)`, `() => (a = b /* c */)`.
    kind(c, unparen(c, node)) === "sequence_expression" ||
    (kind(c, unparen(c, node)) === "assignment_expression" &&
      (kind(c, holder) === "arrow_function" || kind(c, holder) === "variable_declarator"))
  )
    return;
  for (let up = parent(c, node); up !== undefined; node = up, up = parent(c, node)) {
    if (ENDS_WITH_VALUE.has(kind(c, up))) {
      const rest = codeAfter(c, up, node);
      return rest.length === 0 || (rest.length === 1 && kind(c, rest[0]) === ";")
        ? { node: up, as: "trailing" }
        : undefined;
    }
    if (lastCode(c, up) !== node) return;
  }
  return;
};

// In prettier's order within each placement: typeCast and conditional run early, nestedConditional last.
const handlers = [
  oxfmtTypeAliasHead,
  oxfmtCast,
  oxfmtUnionIgnore,
  oxfmtSignatureToken,
  oxfmtTypeMemberEnd,
  oxfmtReturnSequence,
  oxfmtChainHead,
  oxfmtMemberObject,
  oxfmtNewOpenParen,
  oxfmtAfterOptionalCall,
  oxfmtBeforeCallArguments,
  oxfmtSequenceHeadParen,
  afterDeclare,
  typeCast,
  mappedTypeParts,
  importAttribute,
  memberProperty,
  beforeArguments,
  conditional,
  typeBeforeSemicolon,
  beforeSemicolon,
  lastUnionMember,
  unionMember,
  typeAliasValue,
  typeParameterBound,
  requireSource,
  assignmentPattern,
  beforeSignatureParameters,
  methodName,
  fieldDecorator,
  methodDecorator,
  functionBody,
  arrowBody,
  forEmptyPart,
  emptyImport,
  specifier,
  statementBody,
  switchHead,
  tryBlock,
  labeled,
  switchDefault,
  classHeader,
  declaratorValue,
  propertySignatureColon,
  asType,
  nestedConditional,
  firstUnionMember,
];

export const handleComment: CommentHandler<JsOptions> = (original) => {
  const c = outOfTypeParens(original);
  for (const h of [
    oxfmtForInHead,
    oxfmtAfterDroppedParen,
    afterOpenParen,
    beforeStatementCloseParen,
    oxfmtJumpSemicolon,
    besideEmptyStatement,
    ...handlers,
  ]) {
    const target = h(c);
    if (target) return target;
  }
  if (c === original) return undefined;
  // The core's own placement, over the neighbours outside the parentheses.
  const { preceding, following } = c;
  if (c.placement === "ownLine")
    return following !== undefined
      ? { node: following, as: "leading" }
      : preceding !== undefined
        ? { node: preceding, as: "trailing" }
        : undefined;
  return preceding !== undefined
    ? { node: preceding, as: "trailing" }
    : following !== undefined
      ? { node: following, as: "leading" }
      : undefined;
};
