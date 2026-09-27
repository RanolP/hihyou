// match statements, their case clauses, and patterns.
import { custom, space } from "../../../fmt/dsl/dsl.js";
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
  // A wildcard, a negative number (`-` and the number), or one pattern; a `(p)` tuple's parentheses are p's own.
  case_pattern: ($) => ["_", "-", $.children.andThen((p) => p.via("match.pattern"))],
  // Ruff lays out every `|` at once, each line break by where the pattern stands.
  union_pattern: () => custom("match.or"),
  // `-` is the real part's sign or the operator, which only their order tells apart: the real part's custom prints both.
  complex_pattern: ($) => [
    $.children.at(0).andThen((r) => r.via("match.complexReal")),
    $.children.at(1).andThen((i) => i),
  ],
  as_pattern: ($) => [
    $.children.at(0).andThen((p) => p.via("match.pattern")),
    space,
    "as",
    space,
    // A case's `as` names an identifier in no field; `alias` is a with-item's `as` target.
    $.children.at(1).andThen((n) => n),
  ],
  splat_pattern: ($) => ["*", "**", "_", $.children.andThen((n) => n)],
  keyword_pattern: ($) => [
    $.children.at(0).andThen((n) => n),
    "=",
    $.children.at(1).andThen((v) => v.via("match.keywordValue")),
  ],
} satisfies Structure;
