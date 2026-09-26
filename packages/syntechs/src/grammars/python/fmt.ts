import {
  type RuffOptions,
  ruffDefaults,
  ruffSettings,
} from "../../fmt/options.js";
import { defineLanguage } from "../../fmt/rules.js";
import { grammar } from "./bundle.js";
import { toAst } from "./fmt/ast.js";
import { Fmt, type PyOptions } from "./fmt/builders.js";
import { attach, normalizeComment } from "./fmt/comments.js";
import { normalize } from "./fmt/normalize.js";
import { formatModule } from "./fmt/stmt/suite.js";
import { language } from "./index.js";

/** Ruff's `[format]` options by their `ruff.toml` names. */
export type PythonOptions = RuffOptions & PyOptions;

const defaults: PythonOptions = {
  ...ruffDefaults,
  "quote-style": "double",
  "skip-magic-trailing-comma": false,
};

/** Ruff 0.16.8's layout (stable style): the module is lowered to ruff's AST and printed by ports of its rules. */
export const python = defineLanguage(
  grammar,
  {
    parser: language,
    atoms: ["string", "concatenated_string"],
    lineComments: { comment: "" },
    defaults,
    settings: ruffSettings,
    normalize,
    comment: normalizeComment,
  },
  () => ({
    module: (node, ctx) => {
      const m = toAst(node, ctx.source);
      return formatModule(
        new Fmt(ctx.source, ctx.options, attach(m, ctx.source)),
        m,
      );
    },
  }),
);
