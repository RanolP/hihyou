// Python's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts. The
// module is one custom rule: ruff's rules (fmt/**) print by ruff's own AST, which the tree-sitter-keyed DSL cannot
// address, so they stay hand-written and write the stream through fmt/elements.ts. The kinds' rules live in
// format/<domain>.ts, each domain's `.via` customs beside it in format/<domain>.via.ts.
import { custom, defineFormat, type FormatSpec } from "../../fmt/dsl/dsl.js";
import type { grammar } from "./bundle.js";
import type { PythonOptions } from "./fmt.js";
import { collection } from "./format/collection.js";
import { expr } from "./format/expr.js";
import { exprAccess } from "./format/expr-access.js";
import { stmtCompound } from "./format/stmt-compound.js";
import { stmtDef } from "./format/stmt-def.js";
import { stmtMatch } from "./format/stmt-match.js";
import { stmtSimple } from "./format/stmt-simple.js";
import { string } from "./format/string.js";

/** One domain's share of the spec's structure rules. */
export type Structure = FormatSpec<typeof grammar, PythonOptions>["structure"];

const format = defineFormat<typeof grammar, PythonOptions>();

export const python = format({
  structure: {
    module: () => custom("module"),
    ...stmtSimple,
    ...stmtCompound,
    ...stmtDef,
    ...stmtMatch,
    ...expr,
    ...exprAccess,
    ...collection,
    ...string,
  },
});
