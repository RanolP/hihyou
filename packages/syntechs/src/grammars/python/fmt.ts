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
import { printing, sToken, within } from "./fmt/sink.js";
import { normalize } from "./fmt/normalize.js";
import { writeModule } from "./fmt/stmt/suite.js";
import * as gen from "./fmt.gen.js";
import { collectionVia } from "./format/collection.via.js";
import { exprVia } from "./format/expr.via.js";
import { exprAccessVia } from "./format/expr-access.via.js";
import { stmtCompoundVia } from "./format/stmt-compound.via.js";
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
};

// The rules print by ruff's own AST and its comments keyed by it, which the tree-sitter-keyed placement cannot
// give back (several ruff nodes share one tree-sitter node), so the placement pass hands both to the module rule.
const ruffPlaced = new WeakMap<
  Comments,
  | { module: Module; comments: RuffComments; byTs: Map<number, Expr>; stmts: Map<number, Stmt> }
  | { error: unknown }
>();

// The one custom rule of the spec (src/grammars/python/format.ts, generated into fmt.gen.ts): ruff's rules.
const module: CustomRule<PythonOptions> = (_, ctx) => {
  const ruff = ruffPlaced.get(ctx.placement);
  if (!ruff) throw new Error("python: the module printed without its placement pass");
  if ("error" in ruff) throw ruff.error;
  const f = new Fmt(ctx.tree, ctx.options, ruff.comments);
  within(ctx, { f, byTs: ruff.byTs, stmts: ruff.stmts }, () => writeModule(f, ruff.module));
};

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
      placeComments: (tree) => {
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
        ruffPlaced.set(placed, { module, comments, byTs, stmts });
        return placed;
      },
    },
  ),
  stream: {
    ...rules,
    // The core writes a node with no rule (a leaf) straight to the stream; through the sink it lands where the
    // rule printing it (`sDsl`) writes.
    wrap: (node, ctx, print) =>
      rules.rules.has(ctx.tree.kindName(node)) ? print() : sToken(node, ctx.tree.text(node)),
  },
};
