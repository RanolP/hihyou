// Compound statements, their clauses, and blocks.
import { lines, space, tok } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

// A block is always printed by its clause's `compound.body` (ruff's suite), and a clause keyword by
// `compound.alternate`, which prints the comments and blank lines before it.
export const stmtCompound = {
  if_statement: ($) => [
    "if",
    space,
    $.condition.via("compound.ifBreaks"),
    ":",
    $.consequence.via("compound.body"),
    lines($.alternative),
  ],
  elif_clause: ($) => [
    tok("elif").via("compound.alternate"),
    space,
    $.condition.via("compound.ifBreaks"),
    ":",
    $.consequence.via("compound.body"),
  ],
  for_statement: ($) => [
    tok("async").via("compound.async"),
    "for",
    space,
    $.left.via("compound.forTarget"),
    space,
    "in",
    space,
    $.right.via("compound.ifBreaks"),
    ":",
    $.body.via("compound.body"),
    $.alternative.andThen((e) => e),
  ],
  while_statement: ($) => [
    "while",
    space,
    $.condition.via("compound.ifBreaks"),
    ":",
    $.body.via("compound.body"),
    $.alternative.andThen((e) => e),
  ],
  try_statement: ($) => [
    tok("try").via("compound.alternate"),
    ":",
    $.body.via("compound.body"),
    lines($.children),
  ],
  except_clause: ($) => [
    tok("except").via("compound.alternate"),
    "*",
    $.value.at(0).andThen((v) => [space, v.via("compound.exceptType")]),
    ":",
    $.children.via("compound.body"),
  ],
  finally_clause: ($) => [tok("finally").via("compound.alternate"), ":", $.children.via("compound.body")],
  else_clause: ($) => [tok("else").via("compound.alternate"), ":", $.body.via("compound.body")],
} satisfies Structure;
