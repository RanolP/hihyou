// Statements (customs: print/statements.ts). A blank line kept after a statement's content, and a clause's body
// beside or below its head, are customs.
import { custom, space } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const statements = {
  program: () => custom("stmt.program"),
  hash_bang_line: () => custom("stmt.hashBang"),
  statement_block: () => custom("stmt.block"),
  empty_statement: () => custom("stmt.empty"),
  else_clause: () => custom("stmt.else"),
  for_statement: () => custom("stmt.for"),
  for_in_statement: () => custom("stmt.forIn"),
  try_statement: ($) => [
    "try",
    space,
    $.body,
    $.handler.andThen((h) => [space, h]),
    $.finalizer.andThen((f) => [space, f]),
  ],
  catch_clause: () => custom("stmt.catch"),
  finally_clause: ($) => ["finally", space, $.body],
  switch_case: () => custom("stmt.case"),
  switch_default: () => custom("stmt.case"),
  labeled_statement: () => custom("stmt.labeled"),
} satisfies JsStructure;
