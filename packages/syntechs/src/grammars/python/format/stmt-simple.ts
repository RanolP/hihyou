// One-line statements.
import { space } from "../../../fmt/dsl/dsl.js";
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
} satisfies Structure;
