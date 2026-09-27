// Compound statements, their clauses, and blocks.
import { custom, lines, space, tok } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

// A block is printed by its clause's `compound.body`, which prints the comments after the colon and indents it,
// and a clause keyword by `compound.alternate`, which prints the comments and blank lines before it.
export const stmtCompound = {
  // Ruff's suite: the statements and the blank lines between them, by the suite kind its caller passes.
  block: () => custom("compound.suite"),
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
  with_statement: ($) => [
    tok("async").via("compound.async"),
    "with",
    space,
    $.children,
    ":",
    $.body.via("compound.body"),
  ],
  // Given the first item, prints them all, commas and parentheses included, in the layout ruff decides for the
  // whole statement; each item by its rule, in that layout.
  with_clause: ($) => $.children.at(0).andThen((i) => i.via("compound.withItems")),
  with_item: ($) => $.value.via("compound.withItem"),
  else_clause: ($) => [tok("else").via("compound.alternate"), ":", $.body.via("compound.body")],
} satisfies Structure;
