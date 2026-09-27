import type { Language as Parser } from "../../core/index.js";
import { prettierDefaults, prettierSettings } from "../../fmt/options.js";
import {
  defineLanguage,
  type Grammar,
  type Language,
} from "../../fmt/rules.js";
import type { StreamRule } from "../../fmt/stream-format.js";
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
import { needsParens } from "./print/parens.js";
import { semiCustoms } from "./print/semi.js";
import {
  ignoredStatement,
  STATEMENT_LIST_PARENTS,
  sTok,
  statementCustoms,
  statementRules,
} from "./print/statements.js";
import { typeCustoms, typeRules } from "./print/types.js";
import { jsCtx, sToken } from "./sink.js";
import {
  anon,
  isIgnoreComment,
  isJsx,
  items,
  kind,
  lastChildWhere,
  named,
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
  sTok(ctx, open);
  sctx.print(inner, args);
  sTok(ctx, close);
};

/** A node under a `// prettier-ignore` comment keeps its source text. */
const isIgnored = (ctx: JsCtx, n: number) => {
  for (const c of ctx.comments(n).leading)
    if (isIgnoreComment(ctx, c)) return true;
  return isJsx(ctx, n) && jsxIgnored(ctx, n, (c) => isIgnoreComment(ctx, c));
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
  return {
    ...defineLanguage(
      g,
      {
        defaults: { ...defaults, ...overrides },
        settings: prettierSettings,
        parser: language,
        atoms: jsAtoms,
        normalize: jsNormalize,
        lineComments: { comment: "//" } as never,
        handleComment,
      },
      () => ({}),
    ),
    stream: {
      rules,
      lists: new Set(),
      printComment,
      printsOwnComments: (n, s) => {
        const ctx = jsCtx(s).js;
        return (
          (isJsx(ctx, n) && !isIgnored(ctx, n)) || isJsxSpreadArgument(ctx, n) || isHeadVia(ctx, n)
        );
      },
      // A node with no rule prints as its token. A node with one prints as its source text under a
      // prettier-ignore, and inside the parentheses the layout needs where it moved a node the source gave none.
      wrap: (n, s, print) => {
        if (!rules.has(s.tree.kindName(n))) return print();
        const ctx = jsCtx(s).js;
        const parens =
          kind(ctx, n) !== PE && kind(ctx, parent(ctx, n)) !== PE && needsParens(n, ctx);
        if (parens) sToken(n, "(", true);
        if (!isIgnored(ctx, n)) print();
        else if (STATEMENT_LIST_PARENTS.has(kind(ctx, parent(ctx, n)) ?? "")) ignoredStatement(ctx, n);
        else sToken(n, ctx.tree.text(n));
        if (parens) sToken(n, ")", true);
      },
    },
  };
}

/** JavaScript (and JSX) as prettier's `babel` parser prints it. */
export const javascript = jsLanguage(grammar, parser);
