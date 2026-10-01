// Statements (customs: print/statements.ts). A blank line kept after a statement's content, and a clause's body
// beside or below its head, are customs.
import { all, any, custom, fieldIs, has, not, option, parentIs, space, text, tok, when } from "../../../fmt/dsl/dsl.js";
import type { JsStructure } from "../format.js";

export const statements = {
  program: () => custom("stmt.program"),
  hash_bang_line: () => text("trimEnd"),
  statement_block: () => custom("stmt.block"),
  // Prettier's isMeaningfulEmptyStatement: an empty body keeps its `;`, any other empty statement vanishes.
  empty_statement: () =>
    tok(";").synth(
      any(
        all(parentIs("if_statement"), fieldIs("consequence")),
        parentIs("else_clause"),
        all(
          fieldIs("body"),
          any(
            parentIs("do_statement"),
            parentIs("for_in_statement"),
            parentIs("for_statement"),
            parentIs("labeled_statement"),
            parentIs("with_statement"),
            parentIs("while_statement"),
          ),
        ),
      ),
    ),
  else_clause: () => custom("stmt.else"),
  for_statement: () => custom("stmt.for"),
  for_in_statement: () => custom("stmt.forIn"),
  try_statement: () => custom("stmt.try"),
  catch_clause: () => custom("stmt.catch"),
  finally_clause: () => custom("stmt.try"),
  switch_case: () => custom("stmt.case"),
  switch_default: () => custom("stmt.case"),
  labeled_statement: () => custom("stmt.labeled"),
  debugger_statement: () => ["debugger", tok(";").synth(option("semi"))],
  break_statement: ($) => ["break", $.label.andThen((l) => [space, l]), tok(";").synth(option("semi"))],
  continue_statement: ($) => ["continue", $.label.andThen((l) => [space, l]), tok(";").synth(option("semi"))],
  return_statement: ($) => [
    "return",
    $.children.andThen((a) => [space, a.via("stmt.returnArg")]),
    tok(";").synth(option("semi")),
  ],
  throw_statement: ($) => ["throw", space, $.children.via("stmt.returnArg"), tok(";").synth(option("semi"))],
  do_statement: () => custom("stmt.do"),
  while_statement: () => custom("stmt.while"),
  with_statement: () => custom("stmt.while"),
  if_statement: () => custom("stmt.if"),
  switch_statement: () => custom("stmt.switch"),
  variable_declaration: () => custom("stmt.declaration"),
  lexical_declaration: () => custom("stmt.declaration"),
  variable_declarator: () => custom("stmt.declarator"),
  expression_statement: ($) => [
    $.children.via("stmt.asiGuard"),
    // No `;` after a statement needsAsiGuard put one before, or after `namespace N {}`, which parses as one.
    tok(";").synth(all(option("semi"), not(when("stmt.asiGuarded")), not(has("children", "internal_module")))),
  ],
} satisfies JsStructure;
