// Prettier's statement printers: block.js, statement-sequence.js, expression-statement.js, if-statement.js,
// clause.js, for-statement.js, for-x-statement.js, while-statement.js, do-while-statement.js, try-statement.js,
// switch-statement.js, return-statement.js, variable-declaration.js, and estree.js's small statements.

import {
  type Doc,
  group,
  hardline,
  ifBreak,
  indent,
  join,
  line,
  softline,
  synthetic,
  text,
  token,
} from "../../../fmt/doc.js";
import { NO_NODE } from "../../../core/arena.js";
import { lfAfter, nextLineEmpty } from "../../../fmt/text.js";
import { firstLeaf, type FormatTree, prevLeaf } from "../../../fmt/tree.js";
import { expressionNeedsAsiProtection } from "./asi.js";
import { printAssignment } from "./assignment.js";
import { needsParens } from "./parens.js";
import {
  anon,
  CF,
  children,
  field,
  fieldName,
  fields,
  first,
  getComments,
  type HasTree,
  hasComment,
  hasLeadingOwnLineComment,
  isBinaryish,
  isComment,
  isJsx,
  items,
  type JsCtx,
  type JsRule,
  kind,
  lastChildWhere,
  named,
  p,
  parent,
  semi,
  separators,
  src,
  t,
  unparen,
} from "./util.js";

const isEmpty = (x: HasTree, n: number) => kind(x, n) === "empty_statement";

/** The statements whose `;` prettier's locEnd leaves out (loc.js): `foo\n\n;[]` ends at `foo`. */
const SEMI_ENDED = new Set([
  "expression_statement",
  "import_statement",
  "export_statement",
  "return_statement",
  "throw_statement",
  "do_statement",
  "break_statement",
  "continue_statement",
  "debugger_statement",
  "variable_declaration",
  "lexical_declaration",
  "using_declaration",
]);

const BODY_ENDED = new Set([
  "for_statement",
  "for_in_statement",
  "labeled_statement",
  "with_statement",
  "while_statement",
]);

/**
 * Prettier's locEnd for a statement: where its content ends, before a `;` and the comments ahead of it. A
 * compound statement ends where its last body does. Returns the node that ends there: `n` itself, or the
 * last content child of `n` or of its last body.
 */
export function contentEnd(
  x: HasTree,
  n: number,
  keepComments = false,
): number {
  const body = lastBody(x, n);
  if (body !== undefined) return contentEnd(x, body, keepComments);
  if (!SEMI_ENDED.has(kind(x, n))) return n;
  const content = lastChildWhere(
    x,
    n,
    (c) => kind(x, c) !== ";" && (keepComments || !isComment(x, c)),
  );
  return content ?? n;
}

function lastBody(x: HasTree, n: number): number | undefined {
  if (kind(x, n) === "if_statement") {
    const alt = field(x, n, "alternative");
    return alt !== undefined ? first(x, alt) : field(x, n, "consequence");
  }
  return BODY_ENDED.has(kind(x, n)) ? field(x, n, "body") : undefined;
}

const ALWAYS_SEMI_ENDED = new Set([
  "break_statement",
  "continue_statement",
  "debugger_statement",
  "variable_declaration",
  "lexical_declaration",
  "using_declaration",
]);

/** Prettier's statementEndsWithSemicolon: what a `// prettier-ignore`d statement gets a `;` after. */
function endsWithSemi(x: HasTree, n: number): boolean {
  const body = lastBody(x, n);
  if (body !== undefined) return endsWithSemi(x, body);
  if (ALWAYS_SEMI_ENDED.has(kind(x, n))) return true;
  const own = children(x, n).at(-1);
  // A zero-width `;` (TypeScript's inserted one) does not count.
  return (
    SEMI_ENDED.has(kind(x, n)) &&
    own !== undefined &&
    kind(x, own) === ";" &&
    src(x, own) !== ""
  );
}

function lastLeaf(tree: FormatTree, n: number): number {
  for (let c = tree.count(n); c > 0; c = tree.count(n))
    n = tree.child(n, c - 1);
  return n;
}

/**
 * `n`'s text from its start through the end of `end`, a node inside it: the leaves after `end` are cut off
 * the end one by one, each with the whitespace before it, found as what follows the text of the leaf before.
 */
function textThrough(tree: FormatTree, n: number, end: number): string {
  let s = tree.text(n);
  const stop = lastLeaf(tree, end);
  for (let l = lastLeaf(tree, n); l !== stop && l !== NO_NODE;) {
    s = s.slice(0, s.length - tree.text(l).length);
    l = prevLeaf(tree, l);
    const before = tree.text(l);
    let i = s.length;
    while (i > 0 && !s.endsWith(before, i)) i--;
    s = s.slice(0, i);
  }
  return s;
}

/**
 * Prettier's printIgnored for a statement: its source up to its content end, then the `;` the `semi` option
 * asks for, wherever the source put it. Comments ahead of that `;` stay in the text.
 */
export function ignoredStatement(ctx: JsCtx, n: number): Doc {
  let text = textThrough(ctx.tree, n, contentEnd(ctx, n, true));
  if (ctx.options.semi && endsWithSemi(ctx, n)) text += ";";
  else if (needsAsiGuard(ctx, n)) text = `;${text}`;
  return token(n, text);
}

/**
 * Prettier's printStatementSequence: each statement on its own line, a blank line kept after one. An empty
 * statement prints nothing, yet is still printed so that its `;` is accounted for.
 */
export function statementSequence(
  ctx: JsCtx,
  statements: readonly number[],
): Doc {
  const parts: Doc[] = [];
  const last = statements.findLast((s) => !isEmpty(ctx, s));
  for (const s of statements) {
    parts.push(ctx.print(s));
    if (isEmpty(ctx, s) || s === last) continue;
    parts.push(hardline);
    if (isNextLineEmptyAfter(ctx, s)) parts.push(hardline);
  }
  return parts;
}

/** Prettier's isNextLineEmpty for a node: a blank line after its content, or after its `;`. */
function isNextLineEmptyAfter(ctx: JsCtx, n: number): boolean {
  const end = contentEnd(ctx, n);
  return (
    nextLineEmpty(ctx.tree, end) || (end !== n && nextLineEmpty(ctx.tree, n))
  );
}

/** Prettier's printBlockBody: `undefined` when the block holds no statement and no comment. */
function blockBody(
  ctx: JsCtx,
  node: number,
  body = items(ctx, node),
): Doc | undefined {
  const hasBody = body.some((s) => !isEmpty(ctx, s));
  const dangling = ctx.comments(node).dangling;
  if (!hasBody && dangling.length === 0) {
    return undefined;
  }
  return [
    hasBody ? statementSequence(ctx, body) : body.map((s) => ctx.print(s)),
    join(hardline, ctx.dangling(node)),
  ];
}

const NO_HARDLINE_IN_EMPTY_BLOCK = new Set([
  "arrow_function",
  "function_expression",
  "function_declaration",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
  "for_statement",
  "while_statement",
  "do_statement",
  "class_static_block",
  "internal_module",
  "module",
]);

/** A statement block: `{`, the statements indented, `}`. */
export function printBlock(
  ctx: JsCtx,
  node: number,
  body = items(ctx, node),
): Doc {
  const open = t(ctx, anon(ctx, node, "{"));
  const close = t(
    ctx,
    lastChildWhere(ctx, node, (c) => !named(ctx, c) && kind(ctx, c) === "}"),
  );
  const printed = blockBody(ctx, node, body);
  if (printed !== undefined)
    return [open, indent([hardline, printed]), hardline, close];
  const empties = body.map((s) => ctx.print(s));
  const up = parent(ctx, node);
  const bare =
    up !== undefined &&
    (NO_HARDLINE_IN_EMPTY_BLOCK.has(kind(ctx, up)) ||
      (kind(ctx, up) === "catch_clause" &&
        field(ctx, parent(ctx, up) ?? up, "finalizer") === undefined));
  return [open, empties, bare ? [] : hardline, close];
}

const program: JsRule = (node, ctx) => {
  const body = items(ctx, node);
  const hasBody = body.some((s) => !isEmpty(ctx, s));
  return [
    // Prettier keeps a byte order mark.
    ctx.tree.bom ? text("﻿") : [],
    hasBody ? statementSequence(ctx, body) : body.map((s) => ctx.print(s)),
    join(hardline, ctx.dangling(node)),
  ];
};

const hashBang: JsRule = (node, ctx) => t(ctx, node, src(ctx, node).trimEnd());

const statementBlock: JsRule = (node, ctx) => printBlock(ctx, node);

export const STATEMENT_LIST_PARENTS = new Set([
  "program",
  "statement_block",
  "class_static_block",
  "switch_case",
  "switch_default",
]);

const expressionStatement: JsRule = (node, ctx) => {
  const expr = first(ctx, node);
  const own = lastChildWhere(
    ctx,
    node,
    (c) => !named(ctx, c) && kind(ctx, c) === ";",
  );
  const printed = p(ctx, expr);
  // `namespace N {}` parses as an expression statement; it takes no `;`.
  if (kind(ctx, expr) === "internal_module")
    return [printed, own !== undefined ? token(own, "") : []];
  if (needsAsiGuard(ctx, node))
    return [
      synthetic(node, ";"),
      printed,
      own !== undefined ? token(own, "") : [],
    ];
  return [printed, semi(ctx, node, own)];
};

/** Prettier's shouldPrintLeadingSemicolon: with `semi: false`, a statement that would continue the line above. */
function needsAsiGuard(ctx: JsCtx, node: number): boolean {
  if (ctx.options.semi || kind(ctx, node) !== "expression_statement")
    return false;
  const expr = first(ctx, node);
  const up = parent(ctx, node);
  return (
    expr !== undefined &&
    up !== undefined &&
    STATEMENT_LIST_PARENTS.has(kind(ctx, up)) &&
    expressionNeedsAsiProtection(ctx, expr)
  );
}

const BODY_HOLDERS = new Set([
  "do_statement",
  "for_in_statement",
  "for_statement",
  "labeled_statement",
  "with_statement",
  "while_statement",
]);

/** Prettier's isMeaningfulEmptyStatement: an empty body keeps its `;`, any other empty statement vanishes. */
const emptyStatement: JsRule = (node, ctx) => {
  const up = parent(ctx, node);
  const role = fieldName(ctx, node);
  const meaningful =
    up !== undefined &&
    ((kind(ctx, up) === "if_statement" && role === "consequence") ||
      kind(ctx, up) === "else_clause" ||
      (BODY_HOLDERS.has(kind(ctx, up)) && role === "body"));
  return token(node, meaningful ? ";" : "");
};

// Prettier's printClause (clause.js).
function clause(ctx: JsCtx, body: number | undefined, elseIf = false): Doc {
  if (body === undefined) return [];
  const doc = ctx.print(body);
  if (isEmpty(ctx, body))
    return hasComment(ctx, body, CF.Leading) ? [text(" "), doc] : doc;
  const isBlock = kind(ctx, body) === "statement_block";
  const leading = getComments(ctx, body, CF.Leading)[0];
  if (
    leading !== undefined &&
    (src(ctx, leading).includes("\n") || ctx.tree.lf(leading) > 0)
  )
    return isBlock ? [hardline, doc] : indent([hardline, doc]);
  if (isBlock || elseIf) return [text(" "), doc];
  return indent([line, doc]);
}

const isLogicalNot = (x: HasTree, n: number | undefined) =>
  kind(x, n) === "unary_expression" &&
  kind(x, field(x, n as number, "operator")) === "!";

// Prettier's shouldInlineCondition (miscellaneous.js).
function shouldInlineCondition(ctx: JsCtx, n: number): boolean {
  if (hasComment(ctx, n) || !isLogicalNot(ctx, n)) return false;
  let a = unparen(ctx, field(ctx, n, "argument") ?? n);
  if (isLogicalNot(ctx, a)) a = unparen(ctx, field(ctx, a, "argument") ?? a);
  return (
    kind(ctx, a) === "binary_expression" &&
    ["&&", "||", "??"].includes(kind(ctx, field(ctx, a, "operator")) ?? "")
  );
}

/**
 * The `(condition)` of an if, while, do-while or with statement, or a switch's discriminant: tree-sitter's
 * parenthesized_expression, whose parentheses are the statement's own.
 */
function parenthesized(
  ctx: JsCtx,
  pe: number | undefined,
  layout: (inner: Doc, node: number) => Doc,
): Doc {
  if (pe === undefined) return [];
  if (kind(ctx, pe) !== "parenthesized_expression")
    return layout(ctx.print(pe), pe);
  const inner = first(ctx, pe);
  const open = t(ctx, anon(ctx, pe, "("));
  const close = t(
    ctx,
    lastChildWhere(ctx, pe, (c) => !named(ctx, c) && kind(ctx, c) === ")"),
  );
  const doc = inner !== undefined ? layout(withParens(ctx, inner), inner) : [];
  return ctx.withComments(pe, [open, doc, close]);
}

/** Prettier prints the condition through needsParens: `if ((a = b))` keeps a pair inside the statement's own. */
function withParens(ctx: JsCtx, inner: number): Doc {
  const printed = ctx.print(inner);
  const expr = unparen(ctx, inner);
  if (!needsParens(expr, ctx)) return printed;
  return [synthetic(expr, "("), printed, synthetic(expr, ")")];
}

const conditionLayout =
  (ctx: JsCtx) =>
  (doc: Doc, node: number): Doc =>
    shouldInlineCondition(ctx, unparen(ctx, node))
      ? doc
      : group([indent([softline, doc]), softline]);

const ifStatement: JsRule = (node, ctx) => {
  const consequent = field(ctx, node, "consequence");
  const alternative = field(ctx, node, "alternative");
  const opening = group([
    t(ctx, anon(ctx, node, "if")),
    text(" "),
    parenthesized(ctx, field(ctx, node, "condition"), conditionLayout(ctx)),
    clause(ctx, consequent),
  ]);
  if (alternative === undefined) return opening;
  const isBlock = kind(ctx, consequent) === "statement_block";
  const parts: Doc[] = [opening];
  let needSpace = isBlock;
  if (!isBlock) {
    parts.push(hardline);
    needSpace = false;
  }
  const dangling = getComments(ctx, node, CF.Dangling);
  const firstComment = dangling[0];
  const lastComment = dangling.at(-1);
  if (firstComment !== undefined && lastComment !== undefined) {
    if (ctx.tree.lf(firstComment) >= 2)
      parts.push(isBlock ? [hardline, hardline] : hardline);
    else if (ctx.tree.lf(firstComment) > 0) parts.push(isBlock ? hardline : []);
    else parts.push(text(" "));
    parts.push(
      join(hardline, ctx.dangling(node)),
      ctx.isLineComment(lastComment) || lfAfter(ctx.tree, lastComment) > 0
        ? hardline
        : text(" "),
    );
    needSpace = false;
  }
  // tree-sitter's else_clause holds `else` and the alternate statement.
  const elseKw = anon(ctx, alternative, "else");
  const body = first(ctx, alternative);
  parts.push(
    needSpace ? text(" ") : [],
    ctx.withComments(alternative, [
      t(ctx, elseKw),
      group(clause(ctx, body, kind(ctx, body) === "if_statement")),
    ]),
  );
  return parts;
};

const elseClause: JsRule = (node, ctx) => {
  const body = first(ctx, node);
  return [
    t(ctx, anon(ctx, node, "else")),
    group(clause(ctx, body, kind(ctx, body) === "if_statement")),
  ];
};

const forStatement: JsRule = (node, ctx) => {
  const body = clause(ctx, field(ctx, node, "body"));
  const dangling = ctx.dangling(node);
  const comments: Doc =
    dangling.length > 0 ? [join(hardline, dangling), softline] : [];
  const open = t(ctx, anon(ctx, node, "("));
  const close = t(
    ctx,
    lastChildWhere(ctx, node, (c) => !named(ctx, c) && kind(ctx, c) === ")"),
  );
  const init = field(ctx, node, "initializer");
  const conditions = fields(ctx, node, "condition");
  const update = field(ctx, node, "increment");
  // The first `;` belongs to the initializer (inside a declaration, or after an expression), the second to the
  // condition; an empty part is an empty_statement that is its `;`.
  const semis = children(ctx, node).filter(
    (c) => !named(ctx, c) && kind(ctx, c) === ";",
  );
  const initKind = kind(ctx, init);
  const initIsDeclaration = initKind?.endsWith("declaration") === true;
  const initDoc: Doc =
    init === undefined
      ? []
      : initKind === "empty_statement"
        ? []
        : ctx.print(init, { forInit: true });
  const initSemi =
    initKind === "empty_statement"
      ? init
      : initIsDeclaration
        ? undefined
        : semis[0];
  const test = conditions.find(
    (c) => named(ctx, c) && kind(ctx, c) !== "empty_statement",
  );
  const testSemiNode =
    conditions.find((c) => kind(ctx, c) === "empty_statement") ??
    semis.find(
      (s) =>
        s !== initSemi &&
        (test === undefined || ctx.tree.ord(s) > ctx.tree.ord(test)),
    );
  const forKw = t(ctx, anon(ctx, node, "for"));
  const semiDoc = (c: number | undefined): Doc =>
    c !== undefined ? token(c, ";") : synthetic(node, ";");
  const initSemiDoc: Doc = initIsDeclaration ? [] : semiDoc(initSemi);
  if (
    !(init !== undefined && initKind !== "empty_statement") &&
    test === undefined &&
    update === undefined
  )
    return [
      comments,
      group([
        forKw,
        text(" "),
        open,
        initSemiDoc,
        semiDoc(testSemiNode),
        close,
        body,
      ]),
    ];
  return [
    comments,
    group([
      forKw,
      text(" "),
      open,
      group([
        indent([
          softline,
          initDoc,
          initSemiDoc,
          line,
          p(ctx, test),
          semiDoc(testSemiNode),
          update !== undefined ? [line, ctx.print(update)] : [],
        ]),
        softline,
      ]),
      close,
      body,
    ]),
  ];
};

const forInStatement: JsRule = (node, ctx) => {
  // `await using` is a two-token kind; the `await` of `for await` stands before the `(`.
  const kinds = fields(ctx, node, "kind");
  const left = field(ctx, node, "left");
  const value = field(ctx, node, "value");
  const op = field(ctx, node, "operator");
  const eq = anon(ctx, node, "=");
  const forAwait = children(ctx, node).find(
    (c) => kind(ctx, c) === "await" && fieldName(ctx, c) === undefined,
  );
  return group([
    t(ctx, anon(ctx, node, "for")),
    forAwait !== undefined ? [text(" "), t(ctx, forAwait)] : [],
    text(" "),
    t(ctx, anon(ctx, node, "(")),
    kinds.map((k) => [t(ctx, k), text(" ")]),
    p(ctx, left),
    value !== undefined
      ? [text(" "), t(ctx, eq), text(" "), ctx.print(value)]
      : [],
    text(" "),
    t(ctx, op),
    text(" "),
    p(ctx, field(ctx, node, "right")),
    t(
      ctx,
      lastChildWhere(ctx, node, (c) => !named(ctx, c) && kind(ctx, c) === ")"),
    ),
    clause(ctx, field(ctx, node, "body")),
  ]);
};

const whileStatement: JsRule = (node, ctx) => {
  const kw = anon(ctx, node, "while") ?? anon(ctx, node, "with");
  const cond = field(ctx, node, "condition") ?? field(ctx, node, "object");
  return group([
    t(ctx, kw),
    text(" "),
    parenthesized(ctx, cond, conditionLayout(ctx)),
    clause(ctx, field(ctx, node, "body")),
  ]);
};

const doStatement: JsRule = (node, ctx) => {
  const body = field(ctx, node, "body");
  return [
    group([t(ctx, anon(ctx, node, "do")), clause(ctx, body)]),
    kind(ctx, body) === "statement_block" ? text(" ") : hardline,
    t(ctx, anon(ctx, node, "while")),
    text(" "),
    parenthesized(ctx, field(ctx, node, "condition"), conditionLayout(ctx)),
    semi(ctx, node),
  ];
};

const tryStatement: JsRule = (node, ctx) => {
  const handler = field(ctx, node, "handler");
  const finalizer = field(ctx, node, "finalizer");
  return [
    t(ctx, anon(ctx, node, "try")),
    text(" "),
    p(ctx, field(ctx, node, "body")),
    handler !== undefined ? [text(" "), ctx.print(handler)] : [],
    finalizer !== undefined ? [text(" "), ctx.print(finalizer)] : [],
  ];
};

const catchClause: JsRule = (node, ctx) => {
  const param = field(ctx, node, "parameter");
  const body = field(ctx, node, "body");
  const catchKw = t(ctx, anon(ctx, node, "catch"));
  if (param === undefined) return [catchKw, text(" "), p(ctx, body)];
  // A comment before the parameter ends ahead of its first leaf; one after it follows its whole subtree.
  const before = ctx.tree.ord(firstLeaf(ctx.tree, param));
  const after = ctx.tree.ord(param);
  const hasComments = hasComment(
    ctx,
    param,
    0,
    (c) =>
      ctx.isLineComment(c) ||
      (ctx.tree.ord(c) < before && lfAfter(ctx.tree, c) > 0) ||
      (ctx.tree.ord(c) > after && ctx.tree.lf(c) > 0),
  );
  const open = t(ctx, anon(ctx, node, "("));
  const close = t(ctx, anon(ctx, node, ")"));
  // A TypeScript catch parameter's annotation (`catch (e: unknown)`).
  const type = field(ctx, node, "type");
  const printed: Doc = [
    ctx.print(param),
    type !== undefined ? ctx.print(type) : [],
  ];
  return [
    catchKw,
    text(" "),
    hasComments
      ? [open, indent([softline, printed]), softline, close]
      : [open, printed, close],
    text(" "),
    p(ctx, body),
  ];
};


const switchStatement: JsRule = (node, ctx) => {
  const body = field(ctx, node, "body");
  const cases = body !== undefined ? items(ctx, body) : [];
  const disc = field(ctx, node, "value");
  const header = group([
    t(ctx, anon(ctx, node, "switch")),
    text(" "),
    parenthesized(ctx, disc, (doc) => [indent([softline, doc]), softline]),
  ]);
  if (body === undefined) return header;
  const open = t(ctx, anon(ctx, body, "{"));
  const close = t(
    ctx,
    lastChildWhere(ctx, body, (c) => !named(ctx, c) && kind(ctx, c) === "}"),
  );
  const dangling = ctx.dangling(body);
  return [
    header,
    text(" "),
    ctx.withComments(body, [
      open,
      cases.length > 0
        ? indent([
            hardline,
            join(
              hardline,
              cases.map((c, i) => [
                ctx.print(c),
                i < cases.length - 1 && nextLineEmpty(ctx.tree, c)
                  ? hardline
                  : [],
              ]),
            ),
          ])
        : dangling.length > 0
          ? indent([hardline, join(hardline, dangling)])
          : [],
      hardline,
      close,
    ]),
  ];
};

const switchCase: JsRule = (node, ctx) => {
  const value = field(ctx, node, "value");
  const parts: Doc[] =
    value !== undefined
      ? [
          t(ctx, anon(ctx, node, "case")),
          text(" "),
          ctx.print(value),
          t(ctx, anon(ctx, node, ":")),
        ]
      : [t(ctx, anon(ctx, node, "default")), t(ctx, anon(ctx, node, ":"))];
  const dangling = ctx.dangling(node);
  if (dangling.length > 0) parts.push(text(" "), join(hardline, dangling));
  const body = items(ctx, node).filter((c) => c !== value);
  const consequent = body.filter((s) => !isEmpty(ctx, s));
  if (consequent.length > 0) {
    const cons = statementSequence(ctx, body);
    parts.push(
      consequent.length === 1 && kind(ctx, consequent[0]) === "statement_block"
        ? [text(" "), cons]
        : indent([hardline, cons]),
    );
  } else parts.push(body.map((s) => ctx.print(s)));
  return parts;
};

// Prettier's returnArgumentHasLeadingComment (utilities/return-statement-has-leading-comment.js). Its argument
// has no parentheses, so a comment inside `return (` counts for the expression they wrap.
export function returnArgumentHasLeadingComment(
  ctx: JsCtx,
  arg: number,
): boolean {
  const n = unparen(ctx, arg);
  const leads = (x: number) =>
    hasLeadingOwnLineComment(ctx, x) ||
    (hasComment(ctx, x, CF.Leading, (c) => src(ctx, c).includes("\n")) &&
      !isJsx(ctx, n));
  if (leads(arg) || (n !== arg && leads(n))) return true;
  for (
    let left = leftSide(ctx, n);
    left !== undefined;
    left = leftSide(ctx, unparen(ctx, left))
  )
    if (hasLeadingOwnLineComment(ctx, unparen(ctx, left))) return true;
  return false;
}

/** Prettier's getLeftSide over a node with a naked left side. */
export function leftSide(x: HasTree, n: number): number | undefined {
  switch (kind(x, n)) {
    case "assignment_expression":
    case "augmented_assignment_expression":
    case "binary_expression":
      return field(x, n, "left");
    case "member_expression":
    case "subscript_expression":
      return field(x, n, "object");
    case "call_expression":
      return field(x, n, "function");
    case "ternary_expression":
      return field(x, n, "condition");
    case "sequence_expression":
      return first(x, n);
    case "update_expression": {
      const head = children(x, n)[0];
      return head !== undefined && fieldName(x, head) === "operator"
        ? undefined
        : field(x, n, "argument");
    }
    case "as_expression":
    case "satisfies_expression":
    case "non_null_expression":
      return first(x, n);
    default:
      return undefined;
  }
}

const isTernary = (x: HasTree, n: number | undefined) =>
  n !== undefined && kind(x, unparen(x, n)) === "ternary_expression";

const isChainedTernary = (x: HasTree, n: number) =>
  kind(x, n) === "ternary_expression" &&
  (isTernary(x, field(x, n, "consequence")) ||
    isTernary(x, field(x, n, "alternative")));

const returnStatement: JsRule = (node, ctx) => {
  const kw = anon(ctx, node, "return") ?? anon(ctx, node, "throw");
  const arg = items(ctx, node)[0];
  let argDoc: Doc = [];
  if (arg !== undefined) {
    const printed = ctx.print(arg);
    const inner = unparen(ctx, arg);
    argDoc = returnArgumentHasLeadingComment(ctx, arg)
      ? [
          synthetic(arg, "("),
          indent([hardline, printed]),
          hardline,
          synthetic(arg, ")"),
        ]
      : isBinaryish(ctx, inner) ||
          kind(ctx, inner) === "sequence_expression" ||
          (ctx.options.experimentalTernaries && isChainedTernary(ctx, inner))
        ? group([
            ifBreak(synthetic(arg, "(")),
            indent([softline, printed]),
            softline,
            ifBreak(synthetic(arg, ")")),
          ])
        : printed;
  }
  return [
    t(ctx, kw),
    arg !== undefined ? [text(" "), argDoc] : [],
    semi(ctx, node),
  ];
};

const breakStatement: JsRule = (node, ctx) => {
  const kw = anon(ctx, node, "break") ?? anon(ctx, node, "continue");
  const label = field(ctx, node, "label");
  return [
    t(ctx, kw),
    label !== undefined ? [text(" "), ctx.print(label)] : [],
    semi(ctx, node),
  ];
};

const debuggerStatement: JsRule = (node, ctx) => [
  t(ctx, anon(ctx, node, "debugger")),
  semi(ctx, node),
];

const labeledStatement: JsRule = (node, ctx) => {
  const body = field(ctx, node, "body");
  const colon = t(ctx, anon(ctx, node, ":"));
  const label = p(ctx, field(ctx, node, "label"));
  if (
    body !== undefined &&
    isEmpty(ctx, body) &&
    !hasComment(ctx, body, CF.Leading)
  )
    return [label, colon, ctx.print(body)];
  return [label, colon, text(" "), p(ctx, body)];
};

/** The variable declarations: `var`, `let`/`const` (lexical), `using`; each declarator an assignment. */
const declaration: JsRule = (node, ctx, args) => {
  const declarators = items(ctx, node).filter(
    (c) => kind(ctx, c) === "variable_declarator",
  );
  const seps = separators(ctx, node, declarators);
  // The keywords stand before the first declarator (all of them, when there is none).
  const firstDeclarator = declarators[0];
  const kinds = children(ctx, node).filter(
    (c) =>
      !named(ctx, c) &&
      !isComment(ctx, c) &&
      (firstDeclarator === undefined ||
        ctx.tree.ord(c) < ctx.tree.ord(firstDeclarator)) &&
      kind(ctx, c) !== ";",
  );
  const forInit =
    args?.forInit === true ||
    (kind(ctx, parent(ctx, node)) === "for_statement" &&
      fieldName(ctx, node) === "initializer");
  const printed = declarators.map((d) => ctx.print(d));
  const hasValue = declarators.some(
    (d) => field(ctx, d, "value") !== undefined,
  );
  const firstDoc =
    printed.length === 1 &&
    firstDeclarator !== undefined &&
    !hasComment(ctx, firstDeclarator)
      ? printed[0]
      : printed[0] !== undefined
        ? indent(printed[0])
        : undefined;
  const own = lastChildWhere(
    ctx,
    node,
    (c) => !named(ctx, c) && kind(ctx, c) === ";",
  );
  return group([
    join(
      text(" "),
      kinds.map((k) => t(ctx, k)),
    ),
    firstDoc !== undefined ? [text(" "), firstDoc] : [],
    indent(
      printed.slice(1).map((doc, i) => {
        const previous = declarators[i];
        const sep = previous !== undefined ? seps.get(previous) : undefined;
        return [
          sep !== undefined ? t(ctx, sep) : [],
          hasValue && !forInit ? hardline : line,
          doc,
        ];
      }),
    ),
    // The last declarator's `,` in a recovered tree is not expected; a for-head's `;` is the for's own.
    forInit ? (own !== undefined ? token(own, ";") : []) : semi(ctx, node, own),
  ]);
};

const variableDeclarator: JsRule = (node, ctx) => {
  const name = field(ctx, node, "name");
  const value = field(ctx, node, "value");
  const eq = anon(ctx, node, "=");
  const left: Doc = children(ctx, node)
    .filter((c) => c !== value && c !== eq && !isComment(ctx, c))
    .map((c) => (named(ctx, c) ? ctx.print(c) : t(ctx, c)));
  if (name === undefined) return left;
  return printAssignment(
    ctx,
    node,
    left,
    eq !== undefined ? [text(" "), t(ctx, eq)] : [],
    value,
  );
};

export const statementRules: Record<string, JsRule> = {
  program,
  hash_bang_line: hashBang,
  statement_block: statementBlock,
  expression_statement: expressionStatement,
  empty_statement: emptyStatement,
  if_statement: ifStatement,
  else_clause: elseClause,
  for_statement: forStatement,
  for_in_statement: forInStatement,
  while_statement: whileStatement,
  with_statement: whileStatement,
  do_statement: doStatement,
  try_statement: tryStatement,
  catch_clause: catchClause,
  switch_statement: switchStatement,
  switch_case: switchCase,
  switch_default: switchCase,
  return_statement: returnStatement,
  throw_statement: returnStatement,
  break_statement: breakStatement,
  continue_statement: breakStatement,
  debugger_statement: debuggerStatement,
  labeled_statement: labeledStatement,
  variable_declaration: declaration,
  lexical_declaration: declaration,
  using_declaration: declaration,
  variable_declarator: variableDeclarator,
};
