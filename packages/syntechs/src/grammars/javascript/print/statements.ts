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
import {
  hasNewline,
  hasNewlineInRange,
  isNextLineEmpty,
  isPreviousLineEmpty,
} from "../../../fmt/text.js";
import type { FormatNode } from "../../../fmt/tree.js";
import { expressionNeedsAsiProtection } from "./asi.js";
import { printAssignment } from "./assignment.js";
import { needsParens } from "./parens.js";
import {
  anon,
  CF,
  field,
  fields,
  first,
  getComments,
  hasComment,
  hasLeadingOwnLineComment,
  isBinaryish,
  isComment,
  isJsx,
  items,
  type JsCtx,
  type JsRule,
  p,
  semi,
  separators,
  t,
  unparen,
} from "./util.js";

const isEmpty = (n: FormatNode) => n.kind === "empty_statement";

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
 * compound statement ends where its last body does.
 */
export function contentEnd(n: FormatNode, keepComments = false): number {
  const body = lastBody(n);
  if (body) return contentEnd(body, keepComments);
  if (!SEMI_ENDED.has(n.kind)) return n.end;
  const content = n.children.findLast(
    (c) => c.kind !== ";" && (keepComments || !isComment(c)),
  );
  return content?.end ?? n.end;
}

function lastBody(n: FormatNode): FormatNode | undefined {
  if (n.kind === "if_statement") {
    const alt = field(n, "alternative");
    return alt ? first(alt) : field(n, "consequence");
  }
  return BODY_ENDED.has(n.kind) ? field(n, "body") : undefined;
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
function endsWithSemi(n: FormatNode): boolean {
  const body = lastBody(n);
  if (body) return endsWithSemi(body);
  if (ALWAYS_SEMI_ENDED.has(n.kind)) return true;
  const own = n.children.at(-1);
  return SEMI_ENDED.has(n.kind) && own?.kind === ";" && own.end > own.start;
}

/**
 * Prettier's printIgnored for a statement: its source up to its content end, then the `;` the `semi` option
 * asks for, wherever the source put it. Comments ahead of that `;` stay in the text.
 */
export function ignoredStatement(ctx: JsCtx, n: FormatNode): Doc {
  let text = ctx.source.slice(n.start, contentEnd(n, true));
  if (ctx.options.semi && endsWithSemi(n)) text += ";";
  else if (needsAsiGuard(ctx, n)) text = `;${text}`;
  return token(n, text);
}

/**
 * Prettier's printStatementSequence: each statement on its own line, a blank line kept after one. An empty
 * statement prints nothing, yet is still printed so that its `;` is accounted for.
 */
export function statementSequence(
  ctx: JsCtx,
  statements: readonly FormatNode[],
): Doc {
  const parts: Doc[] = [];
  const last = statements.findLast((s) => !isEmpty(s));
  for (const s of statements) {
    parts.push(ctx.print(s));
    if (isEmpty(s) || s === last) continue;
    parts.push(hardline);
    if (isNextLineEmptyAfter(ctx, s)) parts.push(hardline);
  }
  return parts;
}

/** Prettier's isNextLineEmpty for a node: a blank line after its content, or after its `;`. */
function isNextLineEmptyAfter(ctx: JsCtx, n: FormatNode): boolean {
  const end = contentEnd(n);
  return (
    isNextLineEmpty(ctx.source, end) ||
    (end !== n.end && isNextLineEmpty(ctx.source, n.end))
  );
}

/** Prettier's printBlockBody: `undefined` when the block holds no statement and no comment. */
function blockBody(
  ctx: JsCtx,
  node: FormatNode,
  body = items(node),
): Doc | undefined {
  const hasBody = body.some((s) => !isEmpty(s));
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
  node: FormatNode,
  body = items(node),
): Doc {
  const open = t(ctx, anon(node, "{"));
  const close = t(
    ctx,
    node.children.findLast((c) => !c.named && c.kind === "}"),
  );
  const printed = blockBody(ctx, node, body);
  if (printed) return [open, indent([hardline, printed]), hardline, close];
  const empties = body.map((s) => ctx.print(s));
  const parent = node.parent;
  const bare =
    parent !== undefined &&
    (NO_HARDLINE_IN_EMPTY_BLOCK.has(parent.kind) ||
      (parent.kind === "catch_clause" &&
        field(parent.parent ?? parent, "finalizer") === undefined));
  return [open, empties, bare ? [] : hardline, close];
}

const program: JsRule = (node, ctx) => {
  const body = items(node);
  const hasBody = body.some((s) => !isEmpty(s));
  return [
    // Prettier keeps a byte order mark.
    ctx.source.charCodeAt(0) === 0xfeff ? text("﻿") : [],
    hasBody ? statementSequence(ctx, body) : body.map((s) => ctx.print(s)),
    join(hardline, ctx.dangling(node)),
  ];
};

const hashBang: JsRule = (node, ctx) =>
  t(ctx, node, ctx.source.slice(node.start, node.end).trimEnd());

const statementBlock: JsRule = (node, ctx) => printBlock(ctx, node);

export const STATEMENT_LIST_PARENTS = new Set([
  "program",
  "statement_block",
  "class_static_block",
  "switch_case",
  "switch_default",
]);

const expressionStatement: JsRule = (node, ctx) => {
  const expr = first(node);
  const own = node.children.findLast((c) => !c.named && c.kind === ";");
  const printed = p(ctx, expr);
  // `namespace N {}` parses as an expression statement; it takes no `;`.
  if (expr?.kind === "internal_module")
    return [printed, own ? token(own, "") : []];
  if (needsAsiGuard(ctx, node))
    return [synthetic(node, ";"), printed, own ? token(own, "") : []];
  return [printed, semi(ctx, node, own)];
};

/** Prettier's shouldPrintLeadingSemicolon: with `semi: false`, a statement that would continue the line above. */
function needsAsiGuard(ctx: JsCtx, node: FormatNode): boolean {
  if (ctx.options.semi || node.kind !== "expression_statement") return false;
  const expr = first(node);
  return (
    expr !== undefined &&
    node.parent !== undefined &&
    STATEMENT_LIST_PARENTS.has(node.parent.kind) &&
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
const emptyStatement: JsRule = (node) => {
  const parent = node.parent;
  const meaningful =
    parent !== undefined &&
    ((parent.kind === "if_statement" && node.field === "consequence") ||
      parent.kind === "else_clause" ||
      (BODY_HOLDERS.has(parent.kind) && node.field === "body"));
  return token(node, meaningful ? ";" : "");
};

// Prettier's printClause (clause.js).
function clause(ctx: JsCtx, body: FormatNode | undefined, elseIf = false): Doc {
  if (!body) return [];
  const doc = ctx.print(body);
  if (isEmpty(body))
    return hasComment(ctx, body, CF.Leading) ? [text(" "), doc] : doc;
  const isBlock = body.kind === "statement_block";
  const leading = getComments(ctx, body, CF.Leading)[0];
  if (
    leading &&
    (hasNewlineInRange(ctx.source, leading.start, leading.end) ||
      hasNewline(ctx.source, leading.start, true))
  )
    return isBlock ? [hardline, doc] : indent([hardline, doc]);
  if (isBlock || elseIf) return [text(" "), doc];
  return indent([line, doc]);
}

const isLogicalNot = (n: FormatNode | undefined) =>
  n?.kind === "unary_expression" && field(n, "operator")?.kind === "!";

// Prettier's shouldInlineCondition (miscellaneous.js).
function shouldInlineCondition(ctx: JsCtx, n: FormatNode): boolean {
  if (hasComment(ctx, n) || !isLogicalNot(n)) return false;
  let a = unparen(field(n, "argument") ?? n);
  if (isLogicalNot(a)) a = unparen(field(a, "argument") ?? a);
  return (
    a.kind === "binary_expression" &&
    ["&&", "||", "??"].includes(field(a, "operator")?.kind ?? "")
  );
}

/**
 * The `(condition)` of an if, while, do-while or with statement, or a switch's discriminant: tree-sitter's
 * parenthesized_expression, whose parentheses are the statement's own.
 */
function parenthesized(
  ctx: JsCtx,
  pe: FormatNode | undefined,
  layout: (inner: Doc, node: FormatNode) => Doc,
): Doc {
  if (!pe) return [];
  if (pe.kind !== "parenthesized_expression") return layout(ctx.print(pe), pe);
  const inner = first(pe);
  const open = t(ctx, anon(pe, "("));
  const close = t(
    ctx,
    pe.children.findLast((c) => !c.named && c.kind === ")"),
  );
  const doc = inner ? layout(withParens(ctx, inner), inner) : [];
  return ctx.withComments(pe, [open, doc, close]);
}

/** Prettier prints the condition through needsParens: `if ((a = b))` keeps a pair inside the statement's own. */
function withParens(ctx: JsCtx, inner: FormatNode): Doc {
  const printed = ctx.print(inner);
  const expr = unparen(inner);
  if (!needsParens(expr, ctx)) return printed;
  return [synthetic(expr, "("), printed, synthetic(expr, ")")];
}

const conditionLayout =
  (ctx: JsCtx) =>
  (doc: Doc, node: FormatNode): Doc =>
    shouldInlineCondition(ctx, unparen(node))
      ? doc
      : group([indent([softline, doc]), softline]);

const ifStatement: JsRule = (node, ctx) => {
  const consequent = field(node, "consequence");
  const alternative = field(node, "alternative");
  const opening = group([
    t(ctx, anon(node, "if")),
    text(" "),
    parenthesized(ctx, field(node, "condition"), conditionLayout(ctx)),
    clause(ctx, consequent),
  ]);
  if (!alternative) return opening;
  const isBlock = consequent?.kind === "statement_block";
  const parts: Doc[] = [opening];
  let needSpace = isBlock;
  if (!isBlock) {
    parts.push(hardline);
    needSpace = false;
  }
  const dangling = getComments(ctx, node, CF.Dangling);
  const firstComment = dangling[0];
  const lastComment = dangling.at(-1);
  if (firstComment && lastComment) {
    if (isPreviousLineEmpty(ctx.source, firstComment.start))
      parts.push(isBlock ? [hardline, hardline] : hardline);
    else if (hasNewline(ctx.source, firstComment.start, true))
      parts.push(isBlock ? hardline : []);
    else parts.push(text(" "));
    parts.push(
      join(hardline, ctx.dangling(node)),
      ctx.isLineComment(lastComment) || hasNewline(ctx.source, lastComment.end)
        ? hardline
        : text(" "),
    );
    needSpace = false;
  }
  // tree-sitter's else_clause holds `else` and the alternate statement.
  const elseKw = anon(alternative, "else");
  const body = first(alternative);
  parts.push(
    needSpace ? text(" ") : [],
    ctx.withComments(alternative, [
      t(ctx, elseKw),
      group(clause(ctx, body, body?.kind === "if_statement")),
    ]),
  );
  return parts;
};

const elseClause: JsRule = (node, ctx) => {
  const body = first(node);
  return [
    t(ctx, anon(node, "else")),
    group(clause(ctx, body, body?.kind === "if_statement")),
  ];
};

const forStatement: JsRule = (node, ctx) => {
  const body = clause(ctx, field(node, "body"));
  const dangling = ctx.dangling(node);
  const comments: Doc =
    dangling.length > 0 ? [join(hardline, dangling), softline] : [];
  const open = t(ctx, anon(node, "("));
  const close = t(
    ctx,
    node.children.findLast((c) => !c.named && c.kind === ")"),
  );
  const init = field(node, "initializer");
  const conditions = fields(node, "condition");
  const update = field(node, "increment");
  // The first `;` belongs to the initializer (inside a declaration, or after an expression), the second to the
  // condition; an empty part is an empty_statement that is its `;`.
  const semis = node.children.filter((c) => !c.named && c.kind === ";");
  const initDoc: Doc = !init
    ? []
    : init.kind === "empty_statement"
      ? []
      : ctx.print(init, { forInit: true });
  const initSemi =
    init?.kind === "empty_statement"
      ? init
      : init?.kind.endsWith("declaration")
        ? undefined
        : semis[0];
  const test = conditions.find((c) => c.named && c.kind !== "empty_statement");
  const testSemiNode =
    conditions.find((c) => c.kind === "empty_statement") ??
    semis.find((s) => s !== initSemi && (!test || s.start >= test.end));
  const forKw = t(ctx, anon(node, "for"));
  const semiDoc = (c: FormatNode | undefined): Doc =>
    c ? token(c, ";") : synthetic(node, ";");
  const initSemiDoc: Doc = init?.kind.endsWith("declaration")
    ? []
    : semiDoc(initSemi);
  if (!(init && init.kind !== "empty_statement") && !test && !update)
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
          update ? [line, ctx.print(update)] : [],
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
  const kinds = fields(node, "kind");
  const left = field(node, "left");
  const value = field(node, "value");
  const op = field(node, "operator");
  const eq = anon(node, "=");
  const forAwait = node.children.find(
    (c) => c.kind === "await" && c.field === undefined,
  );
  return group([
    t(ctx, anon(node, "for")),
    forAwait ? [text(" "), t(ctx, forAwait)] : [],
    text(" "),
    t(ctx, anon(node, "(")),
    kinds.map((k) => [t(ctx, k), text(" ")]),
    p(ctx, left),
    value ? [text(" "), t(ctx, eq), text(" "), ctx.print(value)] : [],
    text(" "),
    t(ctx, op),
    text(" "),
    p(ctx, field(node, "right")),
    t(
      ctx,
      node.children.findLast((c) => !c.named && c.kind === ")"),
    ),
    clause(ctx, field(node, "body")),
  ]);
};

const whileStatement: JsRule = (node, ctx) => {
  const kw = anon(node, "while") ?? anon(node, "with");
  const cond = field(node, "condition") ?? field(node, "object");
  return group([
    t(ctx, kw),
    text(" "),
    parenthesized(ctx, cond, conditionLayout(ctx)),
    clause(ctx, field(node, "body")),
  ]);
};

const doStatement: JsRule = (node, ctx) => {
  const body = field(node, "body");
  return [
    group([t(ctx, anon(node, "do")), clause(ctx, body)]),
    body?.kind === "statement_block" ? text(" ") : hardline,
    t(ctx, anon(node, "while")),
    text(" "),
    parenthesized(ctx, field(node, "condition"), conditionLayout(ctx)),
    semi(ctx, node),
  ];
};

const tryStatement: JsRule = (node, ctx) => {
  const handler = field(node, "handler");
  const finalizer = field(node, "finalizer");
  return [
    t(ctx, anon(node, "try")),
    text(" "),
    p(ctx, field(node, "body")),
    handler ? [text(" "), ctx.print(handler)] : [],
    finalizer ? [text(" "), ctx.print(finalizer)] : [],
  ];
};

const catchClause: JsRule = (node, ctx) => {
  const param = field(node, "parameter");
  const body = field(node, "body");
  const catchKw = t(ctx, anon(node, "catch"));
  if (!param) return [catchKw, text(" "), p(ctx, body)];
  const hasComments = hasComment(
    ctx,
    param,
    0,
    (c) =>
      ctx.isLineComment(c) ||
      (c.end <= param.start && hasNewline(ctx.source, c.end)) ||
      (c.start >= param.end && hasNewline(ctx.source, c.start, true)),
  );
  const open = t(ctx, anon(node, "("));
  const close = t(ctx, anon(node, ")"));
  // A TypeScript catch parameter's annotation (`catch (e: unknown)`).
  const type = field(node, "type");
  const printed: Doc = [ctx.print(param), type ? ctx.print(type) : []];
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

const finallyClause: JsRule = (node, ctx) => [
  t(ctx, anon(node, "finally")),
  text(" "),
  p(ctx, field(node, "body")),
];

const switchStatement: JsRule = (node, ctx) => {
  const body = field(node, "body");
  const cases = body ? items(body) : [];
  const disc = field(node, "value");
  const header = group([
    t(ctx, anon(node, "switch")),
    text(" "),
    parenthesized(ctx, disc, (doc) => [indent([softline, doc]), softline]),
  ]);
  if (!body) return header;
  const open = t(ctx, anon(body, "{"));
  const close = t(
    ctx,
    body.children.findLast((c) => !c.named && c.kind === "}"),
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
                i < cases.length - 1 && isNextLineEmpty(ctx.source, c.end)
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
  const value = field(node, "value");
  const parts: Doc[] = value
    ? [
        t(ctx, anon(node, "case")),
        text(" "),
        ctx.print(value),
        t(ctx, anon(node, ":")),
      ]
    : [t(ctx, anon(node, "default")), t(ctx, anon(node, ":"))];
  const dangling = ctx.dangling(node);
  if (dangling.length > 0) parts.push(text(" "), join(hardline, dangling));
  const body = items(node).filter((c) => c !== value);
  const consequent = body.filter((s) => !isEmpty(s));
  if (consequent.length > 0) {
    const cons = statementSequence(ctx, body);
    parts.push(
      consequent.length === 1 && consequent[0]?.kind === "statement_block"
        ? [text(" "), cons]
        : indent([hardline, cons]),
    );
  } else parts.push(body.map((s) => ctx.print(s)));
  return parts;
};

// Prettier's returnArgumentHasLeadingComment (utilities/return-statement-has-leading-comment.js).
function returnArgumentHasLeadingComment(ctx: JsCtx, n: FormatNode): boolean {
  if (
    hasLeadingOwnLineComment(ctx, n) ||
    (hasComment(ctx, n, CF.Leading, (c) =>
      hasNewlineInRange(ctx.source, c.start, c.end),
    ) &&
      !isJsx(unparen(n)))
  )
    return true;
  for (let left = leftSide(n); left; left = leftSide(left))
    if (hasLeadingOwnLineComment(ctx, left)) return true;
  return false;
}

/** Prettier's getLeftSide over a node with a naked left side. */
export function leftSide(n: FormatNode): FormatNode | undefined {
  switch (n.kind) {
    case "assignment_expression":
    case "augmented_assignment_expression":
    case "binary_expression":
      return field(n, "left");
    case "member_expression":
    case "subscript_expression":
      return field(n, "object");
    case "call_expression":
      return field(n, "function");
    case "ternary_expression":
      return field(n, "condition");
    case "sequence_expression":
      return first(n);
    case "update_expression":
      return n.children[0]?.field === "operator"
        ? undefined
        : field(n, "argument");
    case "as_expression":
    case "satisfies_expression":
    case "non_null_expression":
      return first(n);
    default:
      return undefined;
  }
}

const returnStatement: JsRule = (node, ctx) => {
  const kw = anon(node, "return") ?? anon(node, "throw");
  const arg = items(node)[0];
  let argDoc: Doc = [];
  if (arg) {
    const printed = ctx.print(arg);
    const inner = unparen(arg);
    argDoc = returnArgumentHasLeadingComment(ctx, arg)
      ? [
          synthetic(arg, "("),
          indent([hardline, printed]),
          hardline,
          synthetic(arg, ")"),
        ]
      : isBinaryish(inner) || inner.kind === "sequence_expression"
        ? group([
            ifBreak(synthetic(arg, "(")),
            indent([softline, printed]),
            softline,
            ifBreak(synthetic(arg, ")")),
          ])
        : printed;
  }
  return [t(ctx, kw), arg ? [text(" "), argDoc] : [], semi(ctx, node)];
};

const breakStatement: JsRule = (node, ctx) => {
  const kw = anon(node, "break") ?? anon(node, "continue");
  const label = field(node, "label");
  return [
    t(ctx, kw),
    label ? [text(" "), ctx.print(label)] : [],
    semi(ctx, node),
  ];
};

const debuggerStatement: JsRule = (node, ctx) => [
  t(ctx, anon(node, "debugger")),
  semi(ctx, node),
];

const labeledStatement: JsRule = (node, ctx) => {
  const body = field(node, "body");
  const colon = t(ctx, anon(node, ":"));
  const label = p(ctx, field(node, "label"));
  if (body && isEmpty(body) && !hasComment(ctx, body, CF.Leading))
    return [label, colon, ctx.print(body)];
  return [label, colon, text(" "), p(ctx, body)];
};

/** The variable declarations: `var`, `let`/`const` (lexical), `using`; each declarator an assignment. */
const declaration: JsRule = (node, ctx, args) => {
  const declarators = items(node).filter(
    (c) => c.kind === "variable_declarator",
  );
  const seps = separators(node, declarators);
  const kinds = node.children.filter(
    (c) =>
      !c.named &&
      !isComment(c) &&
      c.end <= (declarators[0]?.start ?? node.end) &&
      c.kind !== ";",
  );
  const parent = node.parent;
  const forInit =
    args?.forInit === true ||
    (parent?.kind === "for_statement" && node.field === "initializer");
  const printed = declarators.map((d) => ctx.print(d));
  const hasValue = declarators.some((d) => field(d, "value") !== undefined);
  const firstDeclarator = declarators[0];
  const firstDoc =
    printed.length === 1 && firstDeclarator && !hasComment(ctx, firstDeclarator)
      ? printed[0]
      : printed[0] !== undefined
        ? indent(printed[0])
        : undefined;
  const own = node.children.findLast((c) => !c.named && c.kind === ";");
  return group([
    join(
      text(" "),
      kinds.map((k) => t(ctx, k)),
    ),
    firstDoc !== undefined ? [text(" "), firstDoc] : [],
    indent(
      printed.slice(1).map((doc, i) => {
        const previous = declarators[i];
        const sep = previous ? seps.get(previous) : undefined;
        return [
          sep ? t(ctx, sep) : [],
          hasValue && !forInit ? hardline : line,
          doc,
        ];
      }),
    ),
    // The last declarator's `,` in a recovered tree is not expected; a for-head's `;` is the for's own.
    forInit ? (own ? token(own, ";") : []) : semi(ctx, node, own),
  ]);
};

const variableDeclarator: JsRule = (node, ctx) => {
  const name = field(node, "name");
  const value = field(node, "value");
  const eq = anon(node, "=");
  const left: Doc = node.children
    .filter((c) => c !== value && c !== eq && !isComment(c))
    .map((c) => (c.named ? ctx.print(c) : t(ctx, c)));
  if (!name) return left;
  return printAssignment(
    ctx,
    node,
    left,
    eq ? [text(" "), t(ctx, eq)] : [],
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
  finally_clause: finallyClause,
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
