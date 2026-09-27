import type { Language as Parser } from "../../core/index.js";
import { type Doc, synthetic } from "../../fmt/doc.js";
import { prettierDefaults, prettierSettings } from "../../fmt/options.js";
import {
  defineLanguage,
  type Grammar,
  type Language,
} from "../../fmt/rules.js";
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
import { operatorCustoms, operatorRules } from "./print/operators.js";
import { needsParens } from "./print/parens.js";
import { semiCustoms } from "./print/semi.js";
import {
  ignoredStatement,
  STATEMENT_LIST_PARENTS,
  statementCustoms,
  statementRules,
} from "./print/statements.js";
import { typeCustoms, typeRules } from "./print/types.js";
import { onDoc, record } from "./sink.js";
import {
  anon,
  type Args,
  isIgnoreComment,
  isJsx,
  items,
  kind,
  lastChildWhere,
  named,
  parent,
  type JsCtx,
  type JsOptions,
  type JsRule,
  p,
  t,
  unparen,
  verbatim,
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
};

const PE = "parenthesized_expression";

/**
 * An expression's own parentheses print only where prettier's needsParens wants them; a nested pair collapses
 * into the outer one. The syntactic parentheses of `if (...)` and its kin are the statement's to print.
 */
const parenthesized: JsRule = (n, ctx, args?: Args) => {
  const inner = items(ctx, n)[0];
  if (inner === undefined) return t(ctx, n);
  if (kind(ctx, parent(ctx, n)) === PE) return p(ctx, inner, args);
  if (!needsParens(unparen(ctx, n), ctx)) return p(ctx, inner, args);
  const open = anon(ctx, n, "(");
  const close = lastChildWhere(
    ctx,
    n,
    (c) => !named(ctx, c) && kind(ctx, c) === ")",
  );
  return [t(ctx, open), p(ctx, inner, args), t(ctx, close)];
};

/** A node under a `// prettier-ignore` comment keeps its source text. */
const isIgnored = (ctx: JsCtx, n: number) => {
  for (const c of ctx.comments(n).leading)
    if (isIgnoreComment(ctx, c)) return true;
  return isJsx(ctx, n) && jsxIgnored(ctx, n, (c) => isIgnoreComment(ctx, c));
};

// Kept on the ctx itself, which lives as long as one format: a lookup per node through a WeakMap keyed by ctx
// cost more than the rules it saved.
const CACHE = Symbol("printed");
type Cached = JsCtx & { [CACHE]?: Map<number, Doc> };

/**
 * Every rule runs through here: a node printed twice (a call's arguments tried hugged and then expanded) is
 * printed once, and a node the layout moved to where it needs parentheses the source did not give it gets them.
 */
function wrap(rule: JsRule): JsRule {
  return (n, ctx, args?: Args) => {
    let cache: Map<number, Doc> | undefined;
    if (args === undefined) {
      cache = (ctx as Cached)[CACHE] ??= new Map();
      const hit = cache.get(n);
      if (hit !== undefined) return hit;
    }
    let doc = !isIgnored(ctx, n)
      ? rule(n, ctx, args)
      : STATEMENT_LIST_PARENTS.has(kind(ctx, parent(ctx, n)) ?? "")
        ? record(() => ignoredStatement(ctx, n))
        : verbatim(ctx, n);
    const k = kind(ctx, n);
    if (k !== PE && kind(ctx, parent(ctx, n)) !== PE && needsParens(n, ctx))
      doc = [synthetic(n, "("), doc, synthetic(n, ")")];
    cache?.set(n, doc);
    return doc;
  };
}

/** The JavaScript and TypeScript rules as one table: the grammars share their node kinds. */
export function jsRules(): Record<string, JsRule> {
  const table: Record<string, JsRule> = {
    ...statementRules,
    ...operatorRules,
    ...typeRules,
    parenthesized_expression: parenthesized,
  };
  // The kinds the DSL spec (format.ts) lays out, recorded into Docs while the rest still print by the Doc.
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
  };
  for (const [name, rule] of gen.javascript<JsOptions>(customs).rules) table[name] = onDoc(rule);
  for (const [name, rule] of Object.entries(table)) table[name] = wrap(rule);
  return table;
}

/** A prettier-compatible formatter for one of the JS-family grammars. */
export function jsLanguage(
  g: Grammar,
  language: Parser,
  overrides: Partial<JsOptions> = {},
): Language<JsOptions> {
  return defineLanguage(
    g,
    {
      defaults: { ...defaults, ...overrides },
      settings: prettierSettings,
      parser: language,
      atoms: jsAtoms,
      normalize: jsNormalize,
      lineComments: { comment: "//" } as never,
      printComment: (c, ctx) => record(() => printComment(c, ctx)),
      handleComment,
      printsOwnComments: (n, ctx) =>
        (isJsx(ctx, n) && !isIgnored(ctx as JsCtx, n)) ||
        isJsxSpreadArgument(ctx, n),
    },
    () => jsRules() as never,
  );
}

/** JavaScript (and JSX) as prettier's `babel` parser prints it. */
export const javascript = jsLanguage(grammar, parser);
