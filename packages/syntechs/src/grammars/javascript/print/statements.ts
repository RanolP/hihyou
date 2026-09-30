// Prettier's statement printers: block.js, statement-sequence.js, expression-statement.js, if-statement.js,
// clause.js, for-statement.js, for-x-statement.js, while-statement.js, do-while-statement.js, try-statement.js,
// switch-statement.js, return-statement.js, variable-declaration.js, and estree.js's small statements.
// Their layouts are format.ts's; what it names `custom` is `statementCustoms`, written against sink.ts.

import { NO_NODE } from "../../../core/arena.js";
import type { CustomRule, PredicateRule } from "../../../fmt/dsl/runtime.js";
import {
  commentFacts,
  printLeadingComment,
  printTrailingComment,
  printTrailingComments,
  type StreamRule,
  type Trailed,
} from "../../../fmt/stream-format.js";
import { lfAfter, nextLineEmpty } from "../../../fmt/text.js";
import { firstLeaf, type FormatTree, prevLeaf } from "../../../fmt/tree.js";
import {
  close,
  GROUP,
  IF_BROKEN,
  INDENT,
  type JsStreamCtx,
  jsCtx,
  open,
  SOFT,
  sBeforeBody,
  sBreakParent,
  sHardline,
  sLine,
  sLineSuffixBoundary,
  sText,
  sToken,
  withComments,
} from "../sink.js";
import { expressionNeedsAsiProtection } from "./asi.js";
import { sPrintAssignment } from "./assignment.js";
import { needsParens } from "./parens.js";
import { semiCustoms } from "./semi.js";
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
  isTypeCastComment,
  items,
  type JsCtx,
  type JsOptions,
  kind,
  lastChildWhere,
  named,
  parent,
  separators,
  src,
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

const KEYWORD_ENDED = new Set([
  "break_statement",
  "continue_statement",
  "debugger_statement",
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
  // Prettier ends a break, continue or debugger at its keyword or label, so the comments after it stay out.
  const keep = keepComments && !KEYWORD_ENDED.has(kind(x, n));
  const content = lastChildWhere(
    x,
    n,
    (c) => kind(x, c) !== ";" && (keep || !isComment(x, c)),
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
export function ignoredStatement(ctx: JsCtx, n: number): void {
  let text = textThrough(ctx.tree, n, contentEnd(ctx, n, true));
  if (ctx.options.semi && endsWithSemi(ctx, n)) text += ";";
  else if (needsAsiGuard(ctx, n)) text = `;${text}`;
  sToken(n, text);
}

// ---- sink helpers ----

/** Token `c` as written, or as `as`; nothing when there is none. */
export function sTok(x: HasTree, c: number | undefined, as?: string): void {
  if (c !== undefined) sToken(c, as ?? src(x, c));
}

/** `node` as its rule prints it, with its comments; nothing when there is none. */
const pr = (s: JsStreamCtx, node: number | undefined, args?: Record<string, unknown>) => {
  if (node !== undefined) s.print(node, args);
};

/** `node`'s dangling comments, one per line. */
function danglingLines(s: JsStreamCtx, node: number): void {
  s.danglingComments(node).forEach((c, i) => {
    if (i > 0) sHardline();
    s.comment(c);
  });
}

/**
 * Prettier's printStatementSequence: each statement on its own line, a blank line kept after one. An empty
 * statement prints nothing, yet is still printed so that its `;` is accounted for.
 */
function statementSequence(s: JsStreamCtx, statements: readonly number[]): void {
  const js = s.js;
  const last = statements.findLast((x) => !isEmpty(js, x));
  statements.forEach((x, i) => {
    s.print(x);
    if (isEmpty(js, x) || x === last) return;
    sHardline();
    const next = statements[i + 1];
    // oxfmt measures the gap after the statement's last comment, which a stray `;` can put on a later line.
    const lastTrailing = js.options.compat === "oxfmt" ? s.trailingComments(x).at(-1) : undefined;
    if (
      isNextLineEmptyAfter(js, x) ||
      (lastTrailing !== undefined && nextLineEmpty(js.tree, lastTrailing)) ||
      (next !== undefined &&
        semiLeftOut(js, x, next) &&
        nextLineEmpty(js.tree, next))
    )
      sHardline();
  });
}

/**
 * Whether `next`, an empty statement, is the `;` babel reads as `n`'s own: tree-sitter ends a statement at the
 * line break after a comment (`continue // c\n;`) and leaves the `;` on the next line a statement of its own.
 */
function semiLeftOut(x: HasTree, n: number, next: number): boolean {
  if (!isEmpty(x, next)) return false;
  const body = lastBody(x, n);
  if (body !== undefined) return semiLeftOut(x, body, next);
  const own = children(x, n).at(-1);
  return (
    SEMI_ENDED.has(kind(x, n)) &&
    !(own !== undefined && kind(x, own) === ";" && src(x, own) !== "")
  );
}

/** The statements of a list, as a sequence when one is no empty statement, else each printed for its `;`. */
function statementsOrEmpties(s: JsStreamCtx, body: readonly number[]): void {
  if (body.some((x) => !isEmpty(s.js, x))) statementSequence(s, body);
  else for (const x of body) s.print(x);
}

/** Prettier's isNextLineEmpty for a node: a blank line after its content, or after its `;`. */
function isNextLineEmptyAfter(ctx: JsCtx, n: number): boolean {
  const end = contentEnd(ctx, n);
  return (
    nextLineEmpty(ctx.tree, end) || (end !== n && nextLineEmpty(ctx.tree, n))
  );
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
  "global_module",
]);

/** A statement block: `{`, the statements indented, `}` (prettier's printBlock and printBlockBody). */
function printBlock(s: JsStreamCtx, node: number): void {
  const js = s.js;
  const body = items(js, node);
  sTok(js, anon(js, node, "{"));
  if (body.some((x) => !isEmpty(js, x)) || s.danglingComments(node).length > 0) {
    open(INDENT);
    sHardline();
    statementsOrEmpties(s, body);
    danglingLines(s, node);
    close();
    sHardline();
  } else {
    for (const x of body) s.print(x);
    const up = parent(js, node);
    const bare =
      up !== undefined &&
      (NO_HARDLINE_IN_EMPTY_BLOCK.has(kind(js, up)) ||
        (kind(js, up) === "catch_clause" &&
          field(js, parent(js, up) ?? up, "finalizer") === undefined));
    if (!bare) sHardline();
  }
  sTok(js, lastChildWhere(js, node, (c) => !named(js, c) && kind(js, c) === "}"));
}

export const STATEMENT_LIST_PARENTS = new Set([
  "program",
  "statement_block",
  "class_static_block",
  "switch_case",
  "switch_default",
]);

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

// Prettier's printClause (clause.js).
function clause(s: JsStreamCtx, body: number | undefined, elseIf = false): void {
  if (body === undefined) return;
  const js = s.js;
  if (isEmpty(js, body)) {
    if (hasComment(js, body, CF.Leading)) sBeforeBody(s, body);
    s.print(body);
    return;
  }
  const isBlock = kind(js, body) === "statement_block";
  const leading = getComments(js, body, CF.Leading)[0];
  // oxfmt keeps a comment that starts on the head's line there, however many lines it spans.
  if (
    leading !== undefined &&
    ((src(js, leading).includes("\n") && js.options.compat !== "oxfmt") || js.tree.lf(leading) > 0)
  ) {
    if (isBlock) {
      sHardline();
      s.print(body);
    } else {
      open(INDENT);
      sHardline();
      s.print(body);
      close();
    }
    return;
  }
  if (isBlock || elseIf) {
    sText(" ");
    s.print(body);
    return;
  }
  open(INDENT);
  sLine(0);
  s.print(body);
  close();
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
 * A statement's test, laid out by `body`: indented on its own line when it breaks, in a group of its own when
 * `grouped`, where prettier's shouldInlineCondition keeps a `!(a && b)` hugged.
 */
function conditionBody(s: JsStreamCtx, node: number, body: () => void, grouped: boolean): void {
  if (grouped && shouldInlineCondition(s.js, unparen(s.js, node))) {
    body();
    return;
  }
  if (grouped) open(GROUP);
  open(INDENT);
  sLine(SOFT);
  body();
  close();
  sLine(SOFT);
  if (grouped) close();
}

/**
 * The `(condition)` of an if, while, do-while or with statement, or a switch's discriminant: tree-sitter's
 * parenthesized_expression, whose parentheses are the statement's own. Prettier prints the condition through
 * needsParens, so `if ((a = b))` keeps a pair inside them.
 */
function condition(s: JsStreamCtx, pe: number | undefined, grouped: boolean): void {
  if (pe === undefined) return;
  const js = s.js;
  if (kind(js, pe) !== "parenthesized_expression") {
    conditionBody(s, pe, () => s.print(pe), grouped);
    return;
  }
  const inner = first(js, pe);
  withComments(s, pe, () => {
    sTok(js, anon(js, pe, "("));
    if (inner !== undefined)
      conditionBody(
        s,
        inner,
        () => {
          const expr = unparen(js, inner);
          if (!needsParens(expr, js)) {
            s.print(inner);
            return;
          }
          // Prettier's AST has no source parentheses, so the comments inside them print around the pair
          // needsParens adds: `if ((a, b) /* c */)`.
          const around = (n: number): void =>
            withComments(s, n, () => {
              if (n !== expr) return around(first(js, n)!);
              sToken(expr, "(", true);
              s.printNode(expr);
              sToken(expr, ")", true);
            });
          around(inner);
        },
        grouped,
      );
    sTok(js, lastChildWhere(js, pe, (c) => !named(js, c) && kind(js, c) === ")"));
  });
}

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

/** A switch's case or default: its label, then its statements indented below it. */
const switchCase: CustomRule<JsOptions> = (node, ctx) => {
  const s = jsCtx(ctx);
  const js = s.js;
  const value = field(js, node, "value");
  if (value !== undefined) {
    sTok(js, anon(js, node, "case"));
    sText(" ");
    s.print(value);
  } else sTok(js, anon(js, node, "default"));
  sTok(js, anon(js, node, ":"));
  if (s.danglingComments(node).length > 0) {
    sText(" ");
    danglingLines(s, node);
  }
  const body = items(js, node).filter((c) => c !== value);
  const consequent = body.filter((x) => !isEmpty(js, x));
  if (consequent.length === 0) {
    for (const x of body) s.print(x);
  } else if (
    consequent.length === 1 &&
    kind(js, consequent[0]) === "statement_block"
  ) {
    sText(" ");
    statementSequence(s, body);
  } else {
    open(INDENT);
    sHardline();
    statementSequence(s, body);
    close();
  }
};

const customs = {
  "stmt.program": (node, ctx) => {
    const s = jsCtx(ctx);
    // Prettier keeps a byte order mark.
    if (ctx.tree.bom) sText("﻿");
    statementsOrEmpties(s, items(s.js, node));
    // Babel's Program ends before a comment-only file's comments, so prettier prints them as its trailing
    // comments: one on the same line follows a space, and a blank line before one is kept.
    s.danglingComments(node).forEach((c, i) => {
      const lf = s.js.tree.lf(c);
      if (i > 0 && lf === 0) sText(" ");
      else if (i > 0) {
        sHardline();
        if (lf > 1) sHardline();
      }
      s.comment(c);
    });
  },

  "stmt.block": (node, ctx) => printBlock(jsCtx(ctx), node),

  "stmt.else": (node, ctx) => {
    const s = jsCtx(ctx);
    const body = first(s.js, node);
    sTok(s.js, anon(s.js, node, "else"));
    open(GROUP);
    clause(s, body, kind(s.js, body) === "if_statement");
    close();
  },

  "stmt.for": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const init = field(js, node, "initializer");
    const conditions = fields(js, node, "condition");
    const update = field(js, node, "increment");
    // The first `;` belongs to the initializer (inside a declaration, or after an expression), the second to the
    // condition; an empty part is an empty_statement that is its `;`.
    const semis = children(js, node).filter(
      (c) => !named(js, c) && kind(js, c) === ";",
    );
    const initKind = kind(js, init);
    const initIsDeclaration = initKind?.endsWith("declaration") === true;
    const initSemi =
      initKind === "empty_statement"
        ? init
        : initIsDeclaration
          ? undefined
          : semis[0];
    const test = conditions.find(
      (c) => named(js, c) && kind(js, c) !== "empty_statement",
    );
    const testSemiNode =
      conditions.find((c) => kind(js, c) === "empty_statement") ??
      semis.find(
        (x) =>
          x !== initSemi &&
          (test === undefined || js.tree.ord(x) > js.tree.ord(test)),
      );
    const semiTok = (c: number | undefined) => {
      if (c !== undefined) sToken(c, ";");
      else sToken(node, ";", true);
    };
    const rparen = lastChildWhere(js, node, (c) => !named(js, c) && kind(js, c) === ")");
    // oxfmt's write_for_head_slot: a comment in the head prints before the `;` or `)` after it, one ending its line
    // after a `;` right after that `;`.
    const inHead = (c: number) =>
      js.options.compat === "oxfmt" && rparen !== undefined && js.tree.ord(c) < js.tree.ord(rparen);
    let pending = s.danglingComments(node).filter(inHead);
    const ordOf = (n: number | undefined) => (n === undefined ? Infinity : js.tree.ord(n));
    /**
     * Prints the pending comments `take` picks; `lineStart` when a line separator was just printed, `lineEnd` when
     * one follows.
     */
    const flush = (take: (c: number) => boolean, lineStart = false, lineEnd = false) => {
      let previous: Trailed | undefined;
      const picked = pending.filter(take);
      picked.forEach((c, i) => {
        if (js.tree.lf(c) > 0) {
          if (!lineStart || i > 0) sHardline();
          else sBreakParent();
          if (js.tree.lf(c) > 1) sHardline();
          s.comment(c);
          if (s.isLineComment(c) && !(lineEnd && i === picked.length - 1)) sHardline();
        } else if (lineStart && previous === undefined && !s.isLineComment(c)) {
          s.comment(c);
          previous = { line: false, suffix: false };
        } else previous = printTrailingComment(s, commentFacts(s, c), previous);
      });
      pending = pending.filter((c) => !take(c));
    };
    const before = (token: number | undefined, lineStart = false, lineEnd = false) =>
      flush((c) => js.tree.ord(c) < ordOf(token), lineStart, lineEnd);
    const endOfLine = (next: number | undefined) =>
      flush((c) => js.tree.lf(c) === 0 && lfAfter(js.tree, c) > 0 && js.tree.ord(c) < ordOf(next));
    const headless =
      !(init !== undefined && initKind !== "empty_statement") && test === undefined && update === undefined;
    const initSemiTok = () => {
      if (!initIsDeclaration) {
        before(initSemi);
        semiTok(initSemi);
      }
      endOfLine(testSemiNode);
    };
    const testSemiTok = () => {
      before(testSemiNode, !headless && test === undefined);
      semiTok(testSemiNode);
      endOfLine(rparen);
    };
    const outside = s.danglingComments(node).filter((c) => !inHead(c));
    if (outside.length > 0) {
      outside.forEach((c, i) => {
        if (i > 0) sHardline();
        s.comment(c);
      });
      sLine(SOFT);
    }
    open(GROUP);
    sTok(js, anon(js, node, "for"));
    sText(" ");
    sTok(js, anon(js, node, "("));
    if (headless && pending.length === 0) {
      initSemiTok();
      semiTok(testSemiNode);
    } else {
      open(GROUP);
      open(INDENT);
      sLine(SOFT);
      if (init !== undefined && initKind !== "empty_statement")
        s.print(init, { forInit: true });
      initSemiTok();
      if (!headless) sLine(0);
      pr(s, test);
      testSemiTok();
      if (update !== undefined) {
        sLine(0);
        s.print(update);
      }
      before(rparen, false, true);
      close();
      sLine(SOFT);
      close();
    }
    sTok(js, rparen);
    clause(s, field(js, node, "body"));
    close();
  },

  "stmt.forIn": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const value = field(js, node, "value");
    // `await using` is a two-token kind; the `await` of `for await` stands before the `(`.
    const forAwait = children(js, node).find(
      (c) => kind(js, c) === "await" && fieldName(js, c) === undefined,
    );
    open(GROUP);
    sTok(js, anon(js, node, "for"));
    if (forAwait !== undefined) {
      sText(" ");
      sTok(js, forAwait);
    }
    sText(" ");
    sTok(js, anon(js, node, "("));
    const kinds = fields(js, node, "kind");
    const left = field(js, node, "left");
    // Babel's left is a declaration that starts at its kind, so a comment before the kind leads it from there.
    const kindAt = kinds[0] === undefined ? undefined : js.tree.ord(kinds[0]);
    const beforeKind =
      left === undefined || kindAt === undefined
        ? []
        : s.leadingComments(left).filter((c) => js.tree.ord(c) < kindAt);
    for (const c of beforeKind) printLeadingComment(s, commentFacts(s, c));
    for (const k of kinds) {
      sTok(js, k);
      sText(" ");
    }
    if (left !== undefined && beforeKind.length > 0) {
      for (const c of s.leadingComments(left))
        if (!beforeKind.includes(c)) printLeadingComment(s, commentFacts(s, c));
      s.printNode(left);
      printTrailingComments(s, left);
    } else pr(s, left);
    if (value !== undefined) {
      sText(" ");
      sTok(js, anon(js, node, "="));
      sText(" ");
      s.print(value);
    }
    sText(" ");
    sTok(js, field(js, node, "operator"));
    sText(" ");
    pr(s, field(js, node, "right"));
    // oxfmt's for-in/of head is no group: an end-of-line comment after the right side flushes before the `)`.
    if (js.options.compat === "oxfmt") sLineSuffixBoundary();
    sTok(js, lastChildWhere(js, node, (c) => !named(js, c) && kind(js, c) === ")"));
    clause(s, field(js, node, "body"));
    close();
  },

  /** `try` and `finally`: the keyword, then each part the head keeps (`try {} catch {} finally {}`). */
  "stmt.try": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    for (const c of children(js, node)) {
      if (isComment(js, c)) continue;
      if (named(js, c)) {
        sBeforeBody(ctx, c);
        s.print(c);
      } else sTok(js, c);
    }
  },

  "stmt.catch": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const param = field(js, node, "parameter");
    const body = field(js, node, "body");
    sTok(js, anon(js, node, "catch"));
    sText(" ");
    if (param !== undefined) {
      // A comment before the parameter ends ahead of its first leaf; one after it follows its whole subtree.
      const before = js.tree.ord(firstLeaf(js.tree, param));
      const after = js.tree.ord(param);
      const hasComments = hasComment(
        js,
        param,
        0,
        (c) =>
          js.isLineComment(c) ||
          (js.tree.ord(c) < before && lfAfter(js.tree, c) > 0) ||
          (js.tree.ord(c) > after && js.tree.lf(c) > 0),
      );
      // A TypeScript catch parameter's annotation (`catch (e: unknown)`).
      const type = field(js, node, "type");
      sTok(js, anon(js, node, "("));
      if (hasComments) {
        open(INDENT);
        sLine(SOFT);
      }
      s.print(param);
      pr(s, type);
      if (hasComments) {
        close();
        sLine(SOFT);
      }
      sTok(js, anon(js, node, ")"));
      if (body !== undefined) sBeforeBody(ctx, body);
    }
    pr(s, body);
  },

  /**
   * A return or throw argument (return-statement.js): parenthesized on lines of its own below a leading comment,
   * and a binaryish expression parenthesized while it breaks. A sequence breaks inside its own parentheses.
   */
  "stmt.returnArg": (arg, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const inner = unparen(js, arg);
    if (returnArgumentHasLeadingComment(js, arg)) {
      sToken(arg, "(", true);
      open(INDENT);
      sHardline();
      s.printNode(arg);
      close();
      sHardline();
      sToken(arg, ")", true);
    } else if (
      isBinaryish(js, inner) ||
      (ctx.options.experimentalTernaries && isChainedTernary(js, inner))
    ) {
      open(GROUP);
      open(IF_BROKEN);
      sToken(arg, "(", true);
      close();
      open(INDENT);
      sLine(SOFT);
      s.printNode(arg);
      close();
      sLine(SOFT);
      open(IF_BROKEN);
      sToken(arg, ")", true);
      close();
      close();
    } else s.printNode(arg);
  },

  "stmt.do": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const body = field(js, node, "body");
    open(GROUP);
    sTok(js, anon(js, node, "do"));
    // oxfmt keeps a line break after a comment before a `{`, which prettier's `line` gives only in a broken group.
    const leading = kind(js, body) === "statement_block" ? getComments(js, body as number, CF.Leading)[0] : undefined;
    if (js.options.compat === "oxfmt" && leading !== undefined && lfAfter(js.tree, leading) > 0) sBreakParent();
    clause(s, body);
    close();
    if (kind(js, body) === "statement_block") sText(" ");
    else sHardline();
    sTok(js, anon(js, node, "while"));
    sText(" ");
    condition(s, field(js, node, "condition"), true);
    semiCustoms.semi(
      lastChildWhere(js, node, (c) => !named(js, c) && kind(js, c) === ";"),
      node,
      ctx,
    );
  },

  /** `while` and `with`. */
  "stmt.while": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    open(GROUP);
    sTok(js, anon(js, node, "while") ?? anon(js, node, "with"));
    sText(" ");
    condition(s, field(js, node, "condition") ?? field(js, node, "object"), true);
    clause(s, field(js, node, "body"));
    close();
  },

  /**
   * Prettier's if-statement.js: the head and its consequent in a group; an `else` beside a block, below any other
   * statement, with the comments between them in the gap.
   */
  "stmt.if": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const consequent = field(js, node, "consequence");
    const alternative = field(js, node, "alternative");
    open(GROUP);
    sTok(js, anon(js, node, "if"));
    sText(" ");
    condition(s, field(js, node, "condition"), true);
    clause(s, consequent);
    close();
    if (alternative === undefined) return;
    const isBlock = kind(js, consequent) === "statement_block";
    let needSpace = isBlock;
    let dangling = s.danglingComments(node);
    // oxfmt's write_comments_between_blocks: the comments on the consequent's line trail it outside the `if` group.
    if (js.options.compat === "oxfmt" && !isBlock) {
      const sameLine = dangling.findIndex((c) => js.tree.lf(c) > 0);
      const run = sameLine < 0 ? dangling : dangling.slice(0, sameLine);
      let previous: Trailed | undefined;
      for (const c of run) previous = printTrailingComment(s, commentFacts(s, c), previous);
      dangling = dangling.slice(run.length);
    }
    if (!isBlock) sHardline();
    const firstComment = dangling[0];
    const lastComment = dangling.at(-1);
    if (firstComment !== undefined && lastComment !== undefined) {
      if (js.tree.lf(firstComment) >= 2) {
        sHardline();
        if (isBlock) sHardline();
      } else if (js.tree.lf(firstComment) > 0) {
        if (isBlock) sHardline();
      } else sText(" ");
      dangling.forEach((c, i) => {
        if (i > 0) sHardline();
        s.comment(c);
      });
      if (s.isLineComment(lastComment) || lfAfter(js.tree, lastComment) > 0) sHardline();
      else sText(" ");
      needSpace = false;
    }
    if (needSpace) sText(" ");
    // tree-sitter's else_clause holds `else` and the alternate statement.
    const body = first(js, alternative);
    withComments(s, alternative, () => {
      sTok(js, anon(js, alternative, "else"));
      open(GROUP);
      clause(s, body, kind(js, body) === "if_statement");
      close();
    });
  },

  /** Prettier's switch-statement.js: the cases one per line inside the braces, a blank line kept between two. */
  "stmt.switch": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const body = field(js, node, "body");
    open(GROUP);
    sTok(js, anon(js, node, "switch"));
    sText(" ");
    condition(s, field(js, node, "value"), false);
    close();
    if (body === undefined) return;
    sText(" ");
    const cases = items(js, body);
    withComments(s, body, () => {
      sTok(js, anon(js, body, "{"));
      if (cases.length > 0) {
        open(INDENT);
        sHardline();
        cases.forEach((c, i) => {
          if (i > 0) sHardline();
          s.print(c);
          if (i < cases.length - 1 && nextLineEmpty(js.tree, c)) sHardline();
        });
        close();
      } else if (s.danglingComments(body).length > 0) {
        open(INDENT);
        sHardline();
        danglingLines(s, body);
        close();
      }
      sHardline();
      sTok(js, lastChildWhere(js, body, (c) => !named(js, c) && kind(js, c) === "}"));
    });
  },

  /**
   * Prettier's variable-declaration.js: the keywords, then the declarators, one per line once one has a value
   * (outside a for-head), the first indented with them when there are several or it has comments.
   */
  "stmt.declaration": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const declarators = items(js, node).filter(
      (c) => kind(js, c) === "variable_declarator",
    );
    const seps = separators(js, node, declarators);
    // The keywords stand before the first declarator (all of them, when there is none).
    const firstDeclarator = declarators[0];
    const kinds = children(js, node).filter(
      (c) =>
        !named(js, c) &&
        !isComment(js, c) &&
        (firstDeclarator === undefined ||
          js.tree.ord(c) < js.tree.ord(firstDeclarator)) &&
        kind(js, c) !== ";",
    );
    const forInit =
      s.args?.forInit === true ||
      (kind(js, parent(js, node)) === "for_statement" &&
        fieldName(js, node) === "initializer");
    const hasValue = declarators.some(
      (d) => field(js, d, "value") !== undefined,
    );
    const own = lastChildWhere(
      js,
      node,
      (c) => !named(js, c) && kind(js, c) === ";",
    );
    open(GROUP);
    kinds.forEach((k, i) => {
      if (i > 0) sText(" ");
      sTok(js, k);
    });
    if (firstDeclarator !== undefined) {
      sText(" ");
      const indented =
        declarators.length > 1 || hasComment(js, firstDeclarator);
      if (indented) open(INDENT);
      s.print(firstDeclarator);
      if (indented) close();
    }
    open(INDENT);
    declarators.slice(1).forEach((d, i) => {
      sTok(js, seps.get(declarators[i] as number));
      if (hasValue && !forInit) sHardline();
      else sLine(0);
      s.print(d);
    });
    close();
    // The last declarator's `,` in a recovered tree is not expected; a for-head's `;` is the for's own.
    if (!forInit) semiCustoms.semi(own, node, ctx);
    else if (own !== undefined) sToken(own, ";");
    close();
  },

  /** A declarator is an assignment (assignment.ts): its name and type, `=`, its value. */
  "stmt.declarator": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const value = field(js, node, "value");
    const eq = anon(js, node, "=");
    const name = field(js, node, "name");
    // `c!`: prettier's identifier prints its definite `!`, so the name's comments go after it (`c! /* */`).
    const bang = anon(js, node, "!");
    const left = () => {
      for (const c of children(js, node))
        if (c === value || c === eq || c === bang || isComment(js, c)) continue;
        else if (c === name && bang !== undefined)
          withComments(s, c, () => {
            s.printBare(c);
            sTok(js, bang);
          });
        else if (named(js, c)) s.print(c);
        else sTok(js, c);
    };
    if (name === undefined) {
      left();
      return;
    }
    sPrintAssignment(
      s,
      node,
      left,
      () => {
        if (eq === undefined) return;
        sText(" ");
        sTok(js, eq);
      },
      value,
    );
  },

  "stmt.case": switchCase,
  "stmt.labeled": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const body = field(js, node, "body");
    pr(s, field(js, node, "label"));
    sTok(js, anon(js, node, ":"));
    if (body === undefined) return;
    if (!(isEmpty(js, body) && !hasComment(js, body, CF.Leading))) sBeforeBody(ctx, body);
    s.print(body);
  },

  /** An expression statement's expression, after the `;` needsAsiGuard asks for. */
  "stmt.asiGuard": (expr, ctx) => {
    const js = jsCtx(ctx).js;
    const statement = parent(js, expr);
    if (statement === undefined || !asiGuarded(js, statement)) {
      jsCtx(ctx).printNode(expr);
      return;
    }
    if (!castLedAsi(js, statement)) {
      sToken(statement, ";", true);
      jsCtx(ctx).printNode(expr);
      return;
    }
    const leading = js.comments(statement).leading;
    for (const c of leading.slice(0, -1)) printLeadingComment(ctx, commentFacts(ctx, c));
    sToken(statement, ";", true);
    printLeadingComment(ctx, commentFacts(ctx, leading.at(-1) as number));
    jsCtx(ctx).printNode(expr);
    printTrailingComments(ctx, statement);
  },
} satisfies Record<string, CustomRule<JsOptions>>;

/** needsAsiGuard for an expression statement, but for `namespace N {}`, which parses as one. */
const asiGuarded = (ctx: JsCtx, statement: number) =>
  kind(ctx, first(ctx, statement)) !== "internal_module" &&
  needsAsiGuard(ctx, statement);

/**
 * A guarded statement whose last leading comment is a type cast: the `;` goes between that comment and the
 * ones before it, so the cast stays next to its parentheses, and the statement prints its own comments.
 */
export const castLedAsi = (ctx: JsCtx, statement: number): boolean => {
  const last = ctx.comments(statement).leading.at(-1);
  return last !== undefined && isTypeCastComment(ctx, last) && asiGuarded(ctx, statement);
};

/** An expression statement that needsAsiGuard puts a `;` before, and so none after. */
const asiGuardedStatement: PredicateRule<JsOptions> = (node, ctx) => asiGuarded(jsCtx(ctx).js, node);

/** The rules format.ts names `custom` for the statements. */
export const statementCustoms = { ...customs, "stmt.asiGuarded": asiGuardedStatement };

/** The statement kinds the DSL spec does not name. */
export const statementRules: Record<string, StreamRule<JsOptions>> = {
  // JavaScript's `using`, a kind the tsx grammar the spec is typed against lacks.
  using_declaration: statementCustoms["stmt.declaration"],
};
