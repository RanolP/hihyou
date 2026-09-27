// Python's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts. The
// module is one custom rule: ruff's rules (fmt/**) print by ruff's own AST, which the tree-sitter-keyed DSL cannot
// address, so they stay hand-written and write the stream through fmt/elements.ts.
import { custom, defineFormat } from "../../fmt/dsl/dsl.js";
import type { grammar } from "./bundle.js";
import type { PythonOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, PythonOptions>();

export const python = format({
  structure: {
    module: () => custom("module"),
  },
});
