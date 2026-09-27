// One-line statements.
import { inOrder, space } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const stmtSimple = {
  pass_statement: () => "pass",
  break_statement: () => "break",
  continue_statement: () => "continue",
  return_statement: ($) => ["return", $.children.andThen((v) => [space, v.via("simple.returnValue")])],
  raise_statement: ($) => [
    "raise",
    $.children.andThen((e) => [space, e.via("simple.optional")]),
    $.cause.andThen((c) => [space, "from", space, c.via("simple.optional")]),
  ],
  delete_statement: ($) => ["del", space, $.children.via("simple.deleteTargets")],
  assert_statement: ($) => [
    "assert",
    $.children.at(0).andThen((t) => [space, t.via("simple.ifBreaks")]),
    $.children.at(1).andThen((m) => [",", space, m.via("simple.ifBreaksParenthesized")]),
  ],
  global_statement: ($) => ["global", space, $.children.at(0).andThen((n) => n.via("simple.globalNames"))],
  nonlocal_statement: ($) => ["nonlocal", space, $.children.at(0).andThen((n) => n.via("simple.globalNames"))],
  import_statement: ($) => ["import", space, $.name.at(0).andThen((n) => n.via("simple.importNames"))],
  import_from_statement: ($) => [
    "from",
    space,
    $.module_name,
    space,
    "import",
    space,
    $.children.andThen((w) => w),
    $.name.at(0).andThen((n) => n.via("simple.importFromNames")),
  ],
  future_import_statement: ($) => [
    "from",
    space,
    "__future__",
    space,
    "import",
    space,
    $.name.at(0).andThen((n) => n.via("simple.importFromNames")),
  ],
  wildcard_import: () => "*",
  // A module's or an import's name, its dots included, as written.
  dotted_name: () => inOrder(),
  import_prefix: () => inOrder(),
  relative_import: () => inOrder(),
  aliased_import: ($) => [$.name, space, "as", space, $.alias],
  // Ruff reads an expression, an assignment, an annotated or an augmented one here, each with its own layout.
  expression_statement: ($) => $.children.at(0).andThen((c) => c.via("simple.expressionStatement")),
  type_alias_statement: ($) => ["type", space, $.left.via("simple.typeAlias")],
} satisfies Structure;
