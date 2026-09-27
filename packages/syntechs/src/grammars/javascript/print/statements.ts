// Prettier's statement printers: block.js, statement-sequence.js, expression-statement.js, if-statement.js,
// clause.js, for-statement.js, for-x-statement.js, while-statement.js, do-while-statement.js, try-statement.js,
// switch-statement.js, return-statement.js, variable-declaration.js, and estree.js's small statements.
// Their layouts are format.ts's; what it names `custom` is `statementCustoms`, written against sink.ts.

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
import type { CustomRule } from "../../../fmt/dsl/runtime.js";
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
  sHardline,
  sLine,
  sText,
  sToken,
  withComments,
} from "../sink.js";
import { expressionNeedsAsiProtection } from "./asi.js";
import { printAssignment } from "./assignment.js";
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
  items,
  type JsCtx,
  type JsOptions,
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
  for (const x of statements) {
    s.print(x);
    if (isEmpty(js, x) || x === last) continue;
    sHardline();
    if (isNextLineEmptyAfter(js, x)) sHardline();
  }
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

const BODY_HOLDERS = new Set([
  "do_statement",
  "for_in_statement",
  "for_statement",
  "labeled_statement",
  "with_statement",
  "while_statement",
]);

// Prettier's printClause (clause.js).
function clause(s: JsStreamCtx, body: number | undefined, elseIf = false): void {
  if (body === undefined) return;
  const js = s.js;
  if (isEmpty(js, body)) {
    if (hasComment(js, body, CF.Leading)) sText(" ");
    s.print(body);
    return;
  }
  const isBlock = kind(js, body) === "statement_block";
  const leading = getComments(js, body, CF.Leading)[0];
  if (
    leading !== undefined &&
    (src(js, leading).includes("\n") || js.tree.lf(leading) > 0)
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
          const parens = needsParens(expr, js);
          if (parens) sToken(expr, "(", true);
          s.print(inner);
          if (parens) sToken(expr, ")", true);
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

/** The rules format.ts names `custom` for the statements. */
export const statementCustoms = {
  "stmt.program": (node, ctx) => {
    const s = jsCtx(ctx);
    // Prettier keeps a byte order mark.
    if (ctx.tree.bom) sText("﻿");
    statementsOrEmpties(s, items(s.js, node));
    danglingLines(s, node);
  },

  "stmt.hashBang": (node, ctx) => sToken(node, src(ctx, node).trimEnd()),

  "stmt.block": (node, ctx) => printBlock(jsCtx(ctx), node),

  /** Prettier's isMeaningfulEmptyStatement: an empty body keeps its `;`, any other empty statement vanishes. */
  "stmt.empty": (node, ctx) => {
    const up = parent(ctx, node);
    const role = fieldName(ctx, node);
    const meaningful =
      up !== undefined &&
      ((kind(ctx, up) === "if_statement" && role === "consequence") ||
        kind(ctx, up) === "else_clause" ||
        (BODY_HOLDERS.has(kind(ctx, up)) && role === "body"));
    sToken(node, meaningful ? ";" : "");
  },

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
    const initSemiTok = () => {
      if (!initIsDeclaration) semiTok(initSemi);
    };
    if (s.danglingComments(node).length > 0) {
      danglingLines(s, node);
      sLine(SOFT);
    }
    open(GROUP);
    sTok(js, anon(js, node, "for"));
    sText(" ");
    sTok(js, anon(js, node, "("));
    if (
      !(init !== undefined && initKind !== "empty_statement") &&
      test === undefined &&
      update === undefined
    ) {
      initSemiTok();
      semiTok(testSemiNode);
    } else {
      open(GROUP);
      open(INDENT);
      sLine(SOFT);
      if (init !== undefined && initKind !== "empty_statement")
        s.print(init, { forInit: true });
      initSemiTok();
      sLine(0);
      pr(s, test);
      semiTok(testSemiNode);
      if (update !== undefined) {
        sLine(0);
        s.print(update);
      }
      close();
      sLine(SOFT);
      close();
    }
    sTok(js, lastChildWhere(js, node, (c) => !named(js, c) && kind(js, c) === ")"));
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
    for (const k of fields(js, node, "kind")) {
      sTok(js, k);
      sText(" ");
    }
    pr(s, field(js, node, "left"));
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
    sTok(js, lastChildWhere(js, node, (c) => !named(js, c) && kind(js, c) === ")"));
    clause(s, field(js, node, "body"));
    close();
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
      sText(" ");
    }
    pr(s, body);
  },

  /**
   * A return or throw argument (return-statement.js): parenthesized on lines of its own below a leading comment,
   * and a binaryish or sequence expression parenthesized while it breaks.
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
      kind(js, inner) === "sequence_expression" ||
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
    if (!isBlock) sHardline();
    const dangling = s.danglingComments(node);
    const firstComment = dangling[0];
    const lastComment = dangling.at(-1);
    if (firstComment !== undefined && lastComment !== undefined) {
      if (js.tree.lf(firstComment) >= 2) {
        sHardline();
        if (isBlock) sHardline();
      } else if (js.tree.lf(firstComment) > 0) {
        if (isBlock) sHardline();
      } else sText(" ");
      danglingLines(s, node);
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

  "stmt.case": switchCase,
  "stmt.labeled": (node, ctx) => {
    const s = jsCtx(ctx);
    const js = s.js;
    const body = field(js, node, "body");
    pr(s, field(js, node, "label"));
    sTok(js, anon(js, node, ":"));
    if (
      !(
        body !== undefined &&
        isEmpty(js, body) &&
        !hasComment(js, body, CF.Leading)
      )
    )
      sText(" ");
    pr(s, body);
  },
} satisfies Record<string, CustomRule<JsOptions>>;

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

/**
 * The statement kinds still printed by the Doc: those ending in a `;`; those whose `(condition)` carries comments a
 * custom would drop; and a declarator, an assignment (assignment.ts).
 */
export const statementRules: Record<string, JsRule> = {
  expression_statement: expressionStatement,
  switch_statement: switchStatement,
  variable_declaration: declaration,
  lexical_declaration: declaration,
  using_declaration: declaration,
  variable_declarator: variableDeclarator,
};
