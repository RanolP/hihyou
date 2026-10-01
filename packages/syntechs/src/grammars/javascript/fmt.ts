import type { Language as Parser } from "../../core/index.js";
import {
  prettierDefaults,
  prettierSettings,
} from "../../fmt/options.js";
import {
  defineLanguage,
  type Grammar,
  type Language,
} from "../../fmt/rules.js";
import type { StreamCtx, StreamRule } from "../../fmt/stream-format.js";
import {
  close as closeStream,
  closeSpan,
  GROUP,
  INDENT,
  open as openStream,
  openSpan,
  SOFT,
  sBreakParent,
  sJump,
  sLine,
} from "../../fmt/stream.js";
import { NO_NODE } from "../../core/arena.js";
import { nextLeaf } from "../../fmt/tree.js";
import * as gen from "./fmt.gen.js";
import { grammar, language as parser } from "./index.js";
import { jsAtoms, jsNormalize } from "./normalize.js";
import { assignmentCustoms } from "./print/assignment.js";
import { callCustoms } from "./print/calls.js";
import { classCustoms } from "./print/classes.js";
import { handleComment } from "./print/comments.js";
import { functionCustoms } from "./print/functions.js";
import { isJsxSpreadArgument, jsxCustoms, jsxIgnored } from "./print/jsx.js";
import { literalCustoms, printComment } from "./print/literals.js";
import { moduleCustoms } from "./print/modules.js";
import { objectCustoms } from "./print/objects.js";
import { operatorCustoms } from "./print/operators.js";
import { jsPreds } from "./print/preds.js";
import { isDecoratedClass, needsParens } from "./print/parens.js";
import { semiCustoms } from "./print/semi.js";
import {
  castLedAsi,
  ignoredStatement,
  STATEMENT_LIST_PARENTS,
  sTok,
  statementCustoms,
  statementRules,
} from "./print/statements.js";
import {
  annotationOwnsComments,
  ignoredMemberSeparator,
  typeCustoms,
  typeRules,
  unionOwnsComments,
  unparenType,
} from "./print/types.js";
import { jsCtx, sToken, withComments } from "./sink.js";
import {
  anon,
  children,
  first,
  hasComment,
  isArrayLike,
  isComment,
  isCastParen,
  isIgnoreComment,
  isObjectOrRecord,
  isJsx,
  isNestledComment,
  items,
  kind,
  lastChildWhere,
  named,
  nestledComment,
  parent,
  type JsCtx,
  type JsOptions,
  unparen,
} from "./print/util.js";

const defaults: JsOptions = {
  ...prettierDefaults,
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  quoteProps: "as-needed",
  trailingComma: "all",
  bracketSameLine: false,
  arrowParens: "always",
  experimentalOperatorPosition: "end",
  experimentalTernaries: false,
  parser: "babel",
  sourceType: "unambiguous",
};

const PE = "parenthesized_expression";

/**
 * An expression's own parentheses print only where prettier's needsParens wants them; a nested pair collapses
 * into the outer one. The syntactic parentheses of `if (...)` and its kin are the statement's to print.
 */
const parenthesized: StreamRule<JsOptions> = (n, s) => {
  const sctx = jsCtx(s);
  const ctx = sctx.js;
  const args = sctx.args;
  const inner = items(ctx, n)[0];
  if (inner === undefined) return sTok(ctx, n);
  if (isCastParen(ctx, n)) return castParens(sctx, n, inner);
  if (kind(ctx, parent(ctx, n)) === PE || !needsParens(unparen(ctx, n), ctx)) {
    sctx.print(inner, args);
    return;
  }
  const open = anon(ctx, n, "(");
  const close = lastChildWhere(
    ctx,
    n,
    (c) => !named(ctx, c) && kind(ctx, c) === ")",
  );
  // A unary operator prints a commented argument inside parentheses of its own, which stand for the source's, so
  // the argument's comments print outside the argument's own pair: `!(/* c */ (x = y))`.
  if (kind(ctx, parent(ctx, n)) === "unary_expression") {
    withComments(sctx, inner, () => {
      sTok(ctx, open);
      sctx.printNode(inner, args);
      sTok(ctx, close);
    });
    return;
  }
  // Prettier's printComments wraps the node as printed with its parentheses, so its comments print outside them:
  // `(a = b /* c */)` as `(a = b) /* c */`. Prettier has no nested pairs, so their comments are the node's too.
  const expr = unparen(ctx, n);
  if (!sctx.ownsComments(expr)) {
    const layers: number[] = [];
    for (let m: number | undefined = inner; m !== undefined && m !== expr; m = first(ctx, m))
      layers.push(m);
    layers.push(expr);
    const body = () => {
      sTok(ctx, open);
      printInParens(ctx, expr, () => sctx.printNode(expr, args));
      sTok(ctx, close);
    };
    layers.reduceRight<() => void>((print, m) => () => withComments(sctx, m, print), body)();
    return;
  }
  sTok(ctx, open);
  printInParens(ctx, unparen(ctx, n), () => sctx.print(inner, args));
  sTok(ctx, close);
};

/** Babel's v8intrinsic `%DebugPrint`, which only the JavaScript grammar parses, so the tsx-typed spec has no kind for it. */
const v8Intrinsic: StreamRule<JsOptions> = (n, s) => {
  const sctx = jsCtx(s);
  sTok(sctx.js, anon(sctx.js, n, "%"));
  for (const name of items(sctx.js, n)) sctx.print(name);
};

/** Prettier's printClass for a decorated class expression in parentheses: `(`, the class indented on its own lines, `)`. */
function printInParens(ctx: JsCtx, n: number, print: () => void): void {
  if (!isDecoratedClass(ctx, n)) return print();
  openStream(INDENT);
  sLine(0);
  print();
  closeStream();
  sLine(0);
}

/**
 * A type cast's parentheses, as prettier prints its ParenthesizedExpression: hugging an object or array with no
 * comment, else a group that breaks inside them. Parentheses nested in them collapse into them.
 */
function castParens(sctx: ReturnType<typeof jsCtx>, n: number, inner: number): void {
  const ctx = sctx.js;
  const expr = unparen(ctx, inner);
  const open = anon(ctx, n, "(");
  const close = lastChildWhere(ctx, n, (c) => !named(ctx, c) && kind(ctx, c) === ")");
  const hug = !hasComment(ctx, expr) && (isObjectOrRecord(ctx, expr) || isArrayLike(ctx, expr));
  if (hug) {
    sTok(ctx, open);
    sctx.print(inner, sctx.args);
    sTok(ctx, close);
    return;
  }
  openStream(GROUP);
  sTok(ctx, open);
  openStream(INDENT);
  sLine(SOFT);
  sctx.print(inner, sctx.args);
  closeStream();
  sLine(SOFT);
  sTok(ctx, close);
  closeStream();
}

/** A node under a `// prettier-ignore` comment keeps its source text. */
const isIgnored = (ctx: JsCtx, n: number) =>
  unionIgnored(ctx, n) ||
  afterIgnoreInUnion(ctx, n) ||
  (isJsx(ctx, n) && jsxIgnored(ctx, n, (c) => isIgnoreComment(ctx, c)));

const ledByIgnore = (ctx: JsCtx, n: number) =>
  ctx.comments(n).leading.some((c) => isIgnoreComment(ctx, c));

const isUnion = (ctx: JsCtx, n: number) => kind(ctx, unparenType(ctx, n)) === "union_type";

/**
 * A whole union's source text stays under a `// prettier-ignore` above it or its parentheses: the union itself,
 * without the parentheses, prints as written.
 */
const unionIgnored = (ctx: JsCtx, n: number) => {
  if (!isUnion(ctx, n)) return ledByIgnore(ctx, n);
  if (unparenType(ctx, n) !== n) return false;
  for (let w: number | undefined = n; w !== undefined && unparenType(ctx, w) === n; w = parent(ctx, w))
    if (ledByIgnore(ctx, w)) return true;
  return trailedByIgnore(ctx, n);
};

/** oxc's has_trailing_suppression_comment: `A | B // prettier-ignore`, the ignore right after the node's end. */
const trailedByIgnore = (ctx: JsCtx, n: number) => {
  let last = n;
  for (let c: number | undefined = n; c !== undefined; c = lastChildWhere(ctx, c, (k) => !isComment(ctx, k))) last = c;
  const after = nextLeaf(ctx.tree, last);
  return after !== NO_NODE && isComment(ctx, after) && ctx.tree.lf(after) === 0 && isIgnoreComment(ctx, after);
};

/**
 * `A⏎// prettier-ignore⏎| B`: an ignore comment between union members trails `A` but keeps `B`'s source text
 * (handleUnionTypeComments sets `prettierIgnore` on the following member). tree-sitter nests the union to the left,
 * so the comment is a child of `B`'s union, or ends the nested union before it.
 */
const afterIgnoreInUnion = (ctx: JsCtx, n: number) => {
  const up = parent(ctx, n);
  if (up === undefined || kind(ctx, up) !== "union_type") return false;
  const kids = children(ctx, up);
  for (let i = kids.indexOf(n) - 1; i >= 0; i--) {
    const k = kids[i] as number;
    if (isComment(ctx, k)) {
      if (isIgnoreComment(ctx, k)) return true;
    } else if (kind(ctx, k) === "union_type") {
      const inner = children(ctx, k);
      for (let j = inner.length - 1; j >= 0 && isComment(ctx, inner[j] as number); j--)
        if (isIgnoreComment(ctx, inner[j] as number)) return true;
      return false;
    } else if (named(ctx, k)) return false;
  }
  return false;
};

/**
 * The kid each head custom is reached through (`.via` on it in format/types.ts), by its parent's kind: the
 * custom prints the whole head, the kid among it with the kid's comments, so the kid owns them.
 */
const HEAD_VIA: Readonly<Record<string, string>> = {
  type_alias_declaration: "name",
  enum_assignment: "name",
  property_signature: "name",
  method_signature: "name",
  call_signature: "parameters",
  construct_signature: "parameters",
  index_signature: "type",
};

const isHeadVia = (ctx: JsCtx, n: number) => {
  const head = HEAD_VIA[kind(ctx, parent(ctx, n)) ?? ""];
  return head !== undefined && head === ctx.tree.fieldName(n);
};

/** The JavaScript and TypeScript rules as one table: the grammars share their node kinds. */
export function jsRules(): ReadonlyMap<string, StreamRule<JsOptions>> {
  const rules = new Map<string, StreamRule<JsOptions>>(
    Object.entries({
      ...statementRules,
      ...typeRules,
      parenthesized_expression: parenthesized,
      v8_intrinsic: v8Intrinsic,
    }),
  );
  // The kinds the DSL spec (format.ts) lays out.
  const customs = {
    ...statementCustoms,
    ...moduleCustoms,
    ...operatorCustoms,
    ...typeCustoms,
    ...objectCustoms,
    ...classCustoms,
    ...assignmentCustoms,
    ...callCustoms,
    ...functionCustoms,
    ...jsxCustoms,
    ...literalCustoms,
    ...semiCustoms,
    ...jsPreds,
  };
  for (const [name, rule] of gen.javascript<JsOptions>(customs).rules) rules.set(name, rule);
  return rules;
}

/** A prettier-compatible formatter for one of the JS-family grammars. */
export function jsLanguage(
  g: Grammar,
  language: Parser,
  overrides: Partial<JsOptions> = {},
): Language<JsOptions> {
  const rules = jsRules();
  const base = defineLanguage(g, {
    defaults: { ...defaults, ...overrides },
    settings: prettierSettings,
    parser: language,
    atoms: jsAtoms,
    normalize: jsNormalize,
    lineComments: { comment: "//" } as never,
    // Prettier may print a trailing line comment after another (`y); //2b //2c`), which reads back as one.
    comment: (raw) => (raw.startsWith("//") ? raw.split(/[ \t]+(?=\/\/)/) : raw),
    handleComment,
  });
  return {
    ...base,
    // A comment nestled onto the one before it (`*//**`) is part of that one, which prettier's parser merged
    // them into: it attaches nowhere, and prints with it.
    placeComments: (tree, isComment, options) => {
      const placed = base.placeComments(tree, isComment, options);
      const own = (list: readonly number[]) => list.filter((c) => !isNestledComment(tree, c));
      return {
        of: (n) => {
          const a = placed.of(n);
          return a && { leading: own(a.leading), trailing: own(a.trailing) };
        },
        dangling: (n) => own(placed.dangling(n)),
      };
    },
    stream: {
      rules,
      lists: new Set(),
      // Prettier prints a program of no statement and no comment as the empty string, not a lone line break.
      finalLine: ({ tree }) => tree.count(tree.root) > 0,
      printComment,
      commentEnd: (c, s) => {
        let end = c;
        for (let n = nestledComment(s.tree, c); n !== undefined; n = nestledComment(s.tree, n)) end = n;
        return end;
      },
      printsOwnComments: (n, s) => {
        const ctx = jsCtx(s).js;
        return (
          (isJsx(ctx, n) && !isIgnored(ctx, n)) ||
          isJsxSpreadArgument(ctx, n) ||
          isHeadVia(ctx, n) ||
          (kind(ctx, n) === "expression_statement" && castLedAsi(ctx, n)) ||
          (unionOwnsComments(ctx, n) && !isIgnored(ctx, n)) ||
          (annotationOwnsComments(ctx, n) && !isIgnored(ctx, n))
        );
      },
      // A node with no rule prints as its token. A node with one prints as its source text under a
      // prettier-ignore, and inside the parentheses the layout needs where it moved a node the source gave none.
      wrap: (n, s, print, args) => {
        if (!rules.has(s.tree.kindName(n))) return print();
        if (args !== undefined) return wrapped(n, s, print);
        const cache = ((s as Cached)[CACHE] ??= new Int32Array(s.tree.nodeCount));
        const at = s.tree.ord(n);
        const hit = cache[at] as number;
        if (hit !== 0) return sJump(hit - 1);
        const t = openSpan();
        wrapped(n, s, print);
        closeSpan();
        cache[at] = t + 1;
      },
    },
  };
}

// Prettier's print cache (main/ast-to-doc.js): a node printed with no args prints the same wherever it is
// printed again (an argument printed plain, then hugged), so its second print jumps to the span its first built
// rather than running its rules again, which nested hugs would repeat at every level.
const CACHE = Symbol("printed");
/** By node ordinal, the span its first print built, plus one (0: not printed yet). */
type Cached = { [CACHE]?: Int32Array };

function wrapped(n: number, s: StreamCtx<JsOptions>, print: () => void): void {
  const ctx = jsCtx(s).js;
  const parens = kind(ctx, n) !== PE && kind(ctx, parent(ctx, n)) !== PE && needsParens(n, ctx);
  if (parens) sToken(n, "(", true);
  if (!isIgnored(ctx, n)) {
    if (parens) printInParens(ctx, n, print);
    else print();
    // Prettier prints a string through replaceEndOfLine: its literal line break breaks the groups around it.
    if (kind(ctx, n) === "string" && ctx.tree.text(n).includes("\n")) sBreakParent();
  } else if (STATEMENT_LIST_PARENTS.has(kind(ctx, parent(ctx, n)) ?? "")) ignoredStatement(ctx, n);
  else if (kind(ctx, n) === PE && !isCastParen(ctx, n)) {
    // Prettier's AST has no parentheses: an ignored expression keeps the source text inside its own, and gets
    // the parentheses needsParens adds: `+((a), (b))` keeps one pair around `(a), (b)`, a statement's `((a))` none.
    const inner = unparen(ctx, n);
    const own = kind(ctx, parent(ctx, n)) !== PE && needsParens(inner, ctx);
    if (own) sToken(n, "(", true);
    sToken(inner, ctx.tree.text(inner));
    if (own) sToken(n, ")", true);
  } else {
    sToken(n, ctx.tree.text(n));
    const sep = ignoredMemberSeparator(ctx, n);
    if (sep !== undefined) sToken(sep, ctx.tree.text(sep));
  }
  if (parens) sToken(n, ")", true);
}

/** JavaScript (and JSX) as prettier's `babel` parser prints it. */
export const javascript = jsLanguage(grammar, parser);
