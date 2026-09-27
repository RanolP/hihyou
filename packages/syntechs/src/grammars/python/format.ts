// Python's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts. The
// module is one custom rule: ruff's rules (fmt/**) print by ruff's own AST, which the tree-sitter-keyed DSL cannot
// address, so they stay hand-written and write the stream through fmt/elements.ts.
import { custom, defineFormat, space } from "../../fmt/dsl/dsl.js";
import type { grammar } from "./bundle.js";
import type { PythonOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, PythonOptions>();

export const python = format({
  structure: {
    module: () => custom("module"),
    pass_statement: () => "pass",
    break_statement: () => "break",
    continue_statement: () => "continue",
    return_statement: ($) => ["return", $.children.andThen((v) => [space, v.via("return.value")])],
    raise_statement: ($) => [
      "raise",
      $.children.andThen((e) => [space, e.via("expr.optional")]),
      $.cause.andThen((c) => [space, "from", space, c.via("expr.optional")]),
    ],
    delete_statement: ($) => ["del", space, $.children.via("delete.targets")],
    assert_statement: ($) => [
      "assert",
      $.children.at(0).andThen((t) => [space, t.via("expr.ifBreaks")]),
      $.children.at(1).andThen((m) => [",", space, m.via("expr.ifBreaksParenthesized")]),
    ],
    global_statement: ($) => ["global", space, $.children.at(0).andThen((n) => n.via("global.names"))],
    nonlocal_statement: ($) => ["nonlocal", space, $.children.at(0).andThen((n) => n.via("global.names"))],
  },
});
