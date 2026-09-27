// Statements (customs: print/statements.ts). A blank line kept after a statement's content, and a clause's body
// beside or below its head, are customs.
import { custom, space, text, tok } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const statements = {
  program: () => custom("stmt.program"),
  hash_bang_line: () => text("trimEnd"),
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
  debugger_statement: () => ["debugger", tok(";").via("semi")],
  break_statement: ($) => ["break", $.label.andThen((l) => [space, l]), tok(";").via("semi")],
  continue_statement: ($) => ["continue", $.label.andThen((l) => [space, l]), tok(";").via("semi")],
  return_statement: ($) => [
    "return",
    $.children.andThen((a) => [space, a.via("stmt.returnArg")]),
    tok(";").via("semi"),
  ],
  throw_statement: ($) => ["throw", space, $.children.via("stmt.returnArg"), tok(";").via("semi")],
  do_statement: () => custom("stmt.do"),
  while_statement: () => custom("stmt.while"),
  with_statement: () => custom("stmt.while"),
  if_statement: () => custom("stmt.if"),
  switch_statement: () => custom("stmt.switch"),
  variable_declaration: () => custom("stmt.declaration"),
  lexical_declaration: () => custom("stmt.declaration"),
  variable_declarator: () => custom("stmt.declarator"),
  expression_statement: ($) => [$.children.via("stmt.asiGuard"), tok(";").via("stmt.exprSemi")],
} satisfies JsStructure;
