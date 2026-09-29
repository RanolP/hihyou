import type { Comments } from "../../fmt/comments.js";
import type { CustomRule } from "../../fmt/dsl/runtime.js";
import {
  type RuffOptions,
  ruffDefaults,
  ruffSettings,
} from "../../fmt/options.js";
import { defineLanguage, type Language } from "../../fmt/rules.js";
import { grammar } from "./bundle.js";
import { type Expr, type Module, type Stmt, toAst } from "./fmt/ast.js";
import { Fmt, type PyOptions } from "./fmt/builders.js";
import {
  attach,
  byTreeNode,
  normalizeComment,
  type Comments as RuffComments,
} from "./fmt/comments.js";
import { printing, within } from "./fmt/sink.js";
import type { CodeFormatter } from "./fmt/docstring.js";
import { docstringText, isBytes, isInterpolated, partOf, type Quote } from "./fmt/strings.js";
import { brokenNodes, format } from "../../fmt/format.js";
import type { FormatTree } from "../../fmt/tree.js";
import { resetStream } from "../../fmt/stream.js";
import { parseTree, type Tree } from "../../core/index.js";
import { normalize } from "./fmt/normalize.js";
import { writeModule } from "./fmt/stmt/suite.js";
import * as gen from "./fmt.gen.js";
import { collectionVia } from "./format/collection.via.js";
import { exprVia } from "./format/expr.via.js";
import { exprAccessVia } from "./format/expr-access.via.js";
import { skipClauseHeader, stmtCompoundVia } from "./format/stmt-compound.via.js";
import { stmtDefVia } from "./format/stmt-def.via.js";
import { stmtMatchVia } from "./format/stmt-match.via.js";
import { stmtSimpleVia } from "./format/stmt-simple.via.js";
import { stringVia } from "./format/string.via.js";
import { triviaVia } from "./format/trivia.via.js";
import { language } from "./index.js";

/** Ruff's `[format]` options by their `ruff.toml` names. */
export type PythonOptions = RuffOptions & PyOptions;

const defaults: PythonOptions = {
  ...ruffDefaults,
  "quote-style": "double",
  "skip-magic-trailing-comma": false,
  "docstring-code-format": false,
  "docstring-code-line-length": "dynamic",
};

// The rules print by ruff's own AST and its comments keyed by it, which the tree-sitter-keyed placement cannot
// give back (several ruff nodes share one tree-sitter node), so the placement pass hands both to the module rule.
const ruffPlaced = new WeakMap<
  Comments,
  | {
      module: Module;
      comments: RuffComments;
      byTs: Map<number, Expr>;
      stmts: Map<number, Stmt>;
      docCode: CodeFormatter | undefined;
    }
  | { error: unknown }
>();

// The one custom rule of the spec (src/grammars/python/format.ts, generated into fmt.gen.ts): ruff's rules.
const module: CustomRule<PythonOptions> = (_, ctx) => {
  const ruff = ruffPlaced.get(ctx.placement);
  if (!ruff) throw new Error("python: the module printed without its placement pass");
  if ("error" in ruff) throw ruff.error;
  const f = new Fmt(ctx.tree, ctx.options, ruff.comments);
  f.docCode = ruff.docCode;
  within(ctx, { f, byTs: ruff.byTs, stmts: ruff.stmts }, () => writeModule(f, ruff.module));
};

/** Whether Python parses `tree`'s text: tree-sitter also takes a compound statement with no body. */
function parses(tree: Tree): boolean {
  if (brokenNodes(tree) !== undefined) return false;
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if (tree.kindName(n) !== "block") continue;
    let body = false;
    for (let i = 0; i < tree.count(n) && !body; i++)
      body = tree.kindName(tree.child(n, i)) !== "comment";
    if (!body) return false;
  }
  return true;
}

/**
 * Ruff's docstring code formatting ahead of printing: every code example of a string that may be a docstring,
 * formatted as its own module. The stream prints one format at a time, so the examples are formatted here, before
 * the module prints anything, and the docstrings read the results as they print.
 */
function formatDocCode(
  tree: FormatTree,
  options: PythonOptions,
  comments: RuffComments,
): CodeFormatter {
  const key = (code: string, width: number, quote: Quote) => `${quote}${width}\n${code}`;
  const wanted = new Map<string, [string, number, Quote]>();
  const f = new Fmt(tree, options, comments);
  f.docCode = (code, width, quote) => {
    wanted.set(key(code, width, quote), [code, width, quote]);
    return undefined;
  };
  for (let o = 0; o < tree.nodeCount; o++) {
    const n = tree.at(o);
    if (tree.kindName(n) !== "string") continue;
    let p = tree.parent(n);
    while (tree.kindName(p) === "parenthesized_expression") p = tree.parent(p);
    if (tree.kindName(p) !== "expression_statement") continue;
    const part = partOf(tree, n);
    if (isBytes(part.flags) || isInterpolated(part.flags)) continue;
    let depth = 0;
    for (let a = tree.parent(p); a !== tree.root; a = tree.parent(a))
      if (tree.kindName(a) === "block") depth++;
    f.depth = depth;
    docstringText(f, part, "");
  }
  const done = new Map<string, string | undefined>();
  for (const [k, [code, width, quote]] of wanted) {
    const parsed = parseTree(language, code);
    let out: string | undefined;
    if (parses(parsed)) {
      const res = format(parsed, python, {
        ...options,
        "line-length": width,
        "indent-style": "space",
        "line-ending": "lf",
        docstringQuote: quote,
      });
      if (res.ok) {
        const q = quote.repeat(3);
        if (parses(parseTree(language, q + res.text + q)))
          out = res.text;
      }
    }
    done.set(k, out);
  }
  if (wanted.size > 0) resetStream(true, options["indent-width"]);
  return (code, width, quote) => done.get(key(code, width, quote));
}

const rules = gen.python({
  module,
  ...stmtSimpleVia,
  ...stmtCompoundVia,
  ...stmtDefVia,
  ...stmtMatchVia,
  ...exprVia,
  ...exprAccessVia,
  ...collectionVia,
  ...stringVia,
  ...triviaVia,
});

/** Ruff 0.16.8's layout (stable style): the module is lowered to ruff's AST and printed by ports of its rules. */
export const python: Language<PythonOptions> = {
  ...defineLanguage(
    grammar,
    {
      parser: language,
      atoms: ["string", "concatenated_string"],
      dropped: ["line_continuation"],
      lineComments: { comment: "" },
      defaults,
      settings: ruffSettings,
      normalize,
      // Ruff prints a node's trailing comments on one line, where Python reads `# a  # b` back as one comment.
      comment: (raw) => raw.split(/[ \t]+(?=#)/).map(normalizeComment),
      placeComments: (tree, _, options) => {
        let module: Module;
        const byTs = new Map<number, Expr>();
        const stmts = new Map<number, Stmt>();
        try {
          module = toAst(tree, byTs, stmts);
        } catch (error) {
          // A tree ruff's AST cannot be read from: its root prints as its source text, comments and all, when the
          // root is the broken node, and otherwise the module rule throws this, as it would have read the AST.
          const placed: Comments = { of: () => undefined, dangling: () => [] };
          ruffPlaced.set(placed, { error });
          return placed;
        }
        const comments = attach(module, tree);
        const byNode = byTreeNode(comments);
        // The module rule prints every comment, the module's own among them and those of the parts the spec's
        // rules print inside it (`sDsl`), so those rules see none.
        const placed: Comments = {
          of: (n) => (n === tree.root || printing() ? undefined : byNode.of(n)),
          dangling: (n) => (printing() ? [] : byNode.dangling(n)),
        };
        const docCode =
          options["docstring-code-format"] && options.docstringQuote === undefined
            ? formatDocCode(tree, options, comments)
            : undefined;
        ruffPlaced.set(placed, { module, comments, byTs, stmts, docCode });
        return placed;
      },
    },
  ),
  stream: {
    ...rules,
    wrap: (n, ctx, print) => {
      if (headed.has(ctx.tree.kindName(n))) skipClauseHeader(n, ctx);
      print();
    },
    // Ruff's `FormatModModule`: a module of no statement and no comment keeps a line only if its source has one.
    // Such a module's root is a node of no width at the end, so its `lf` counts the line breaks of the whole file.
    finalLine: ({ tree }) => tree.count(tree.root) > 0 || tree.lf(tree.root) > 0,
  },
};

// The clauses whose header their own rule prints first; the others' print in `compound.alternate`.
const headed = new Set([
  "if_statement",
  "for_statement",
  "while_statement",
  "with_statement",
  "function_definition",
  "class_definition",
  "match_statement",
  "case_clause",
]);
