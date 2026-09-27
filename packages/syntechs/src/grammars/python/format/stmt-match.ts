// match statements, their case clauses, and patterns.
import { space } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const stmtMatch = {
  match_statement: ($) => [
    "match",
    space,
    $.subject.at(0).andThen((s) => s.via("match.subject")),
    ":",
    $.body.via("match.cases"),
  ],
  case_clause: ($) => [
    "case",
    space,
    $.children.at(0).andThen((p) => p.via("match.casePattern")),
    $.guard.andThen((g) => [space, g.via("match.guard")]),
    ":",
    $.consequence.via("match.caseBody"),
  ],
} satisfies Structure;
