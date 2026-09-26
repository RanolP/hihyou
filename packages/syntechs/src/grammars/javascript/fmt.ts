import type { Language as Parser } from "../../core/index.js";
import { type Doc, synthetic } from "../../fmt/doc.js";
import { prettierDefaults, prettierSettings } from "../../fmt/options.js";
import {
  defineLanguage,
  type Grammar,
  type Language,
} from "../../fmt/rules.js";
import type { FormatNode } from "../../fmt/tree.js";
import { grammar, language as parser } from "./index.js";
import { jsAtoms, jsNormalize } from "./normalize.js";
import { callRules } from "./print/calls.js";
import { classRules } from "./print/classes.js";
import { functionRules } from "./print/functions.js";
import { literalRules, printComment } from "./print/literals.js";
import { moduleRules } from "./print/modules.js";
import { objectRules } from "./print/objects.js";
import { operatorRules } from "./print/operators.js";
import { needsParens } from "./print/parens.js";
import {
  ignoredStatement,
  STATEMENT_LIST_PARENTS,
  statementRules,
} from "./print/statements.js";
import { typeRules } from "./print/types.js";
import {
  type Args,
  items,
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
  parser: "babel",
};

const PE = "parenthesized_expression";

/**
 * An expression's own parentheses print only where prettier's needsParens wants them; a nested pair collapses
 * into the outer one. The syntactic parentheses of `if (...)` and its kin are the statement's to print.
 */
const parenthesized: JsRule = (n, ctx, args?: Args) => {
  const inner = items(n)[0];
  if (!inner) return t(ctx, n);
  if (n.parent?.kind === PE) return p(ctx, inner, args);
  if (!needsParens(unparen(n), ctx)) return p(ctx, inner, args);
  const open = n.children.find((c) => !c.named && c.kind === "(");
  const close = n.children.findLast((c) => !c.named && c.kind === ")");
  return [t(ctx, open), p(ctx, inner, args), t(ctx, close)];
};

const IGNORE = /^(?:\/\/|\/\*)\s*prettier-ignore\s*(?:\*\/)?$/;

/** A node under a `// prettier-ignore` comment keeps its source text. */
const isIgnored = (ctx: JsCtx, n: FormatNode) =>
  ctx
    .comments(n)
    .leading.some((c) =>
      IGNORE.test(ctx.source.slice(c.start, c.end).trimEnd()),
    );

type Cache = WeakMap<FormatNode, Doc>;
const caches = new WeakMap<JsCtx, Cache>();

/**
 * Every rule runs through here: a node printed twice (a call's arguments tried hugged and then expanded) is
 * printed once, and a node the layout moved to where it needs parentheses the source did not give it gets them.
 */
function wrap(rule: JsRule): JsRule {
  return (n, ctx, args?: Args) => {
    let cache: Cache | undefined;
    if (args === undefined) {
      cache = caches.get(ctx);
      if (!cache) {
        cache = new WeakMap();
        caches.set(ctx, cache);
      }
      const hit = cache.get(n);
      if (hit !== undefined) return hit;
    }
    let doc = !isIgnored(ctx, n)
      ? rule(n, ctx, args)
      : STATEMENT_LIST_PARENTS.has(n.parent?.kind ?? "")
        ? ignoredStatement(ctx, n)
        : verbatim(ctx, n);
    if (n.kind !== PE && n.parent?.kind !== PE && needsParens(n, ctx))
      doc = [synthetic(n, "("), doc, synthetic(n, ")")];
    cache?.set(n, doc);
    return doc;
  };
}

/** The JavaScript and TypeScript rules as one table: the grammars share their node kinds. */
export function jsRules(): Record<string, JsRule> {
  const table: Record<string, JsRule> = {
    ...literalRules,
    ...statementRules,
    ...callRules,
    ...functionRules,
    ...objectRules,
    ...operatorRules,
    ...classRules,
    ...moduleRules,
    ...typeRules,
    parenthesized_expression: parenthesized,
  };
  for (const [kind, rule] of Object.entries(table)) table[kind] = wrap(rule);
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
      printComment,
    },
    () => jsRules() as never,
  );
}

/** JavaScript (and JSX) as prettier's `babel` parser prints it. */
export const javascript = jsLanguage(grammar, parser);
