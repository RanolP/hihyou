// Calls, attributes, subscripts, slices, parenthesized expressions, expression lists, splats, and types.
import { tok } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const exprAccess = {
  // Bounds known by the colons around them; the customs space them as ruff does and print its dangling comments.
  slice: ($) => [
    $.children.split(":").at(0).andThen((l) => l.via("access.sliceLower")),
    tok(":").via("access.sliceColon"),
    $.children.split(":").at(1).andThen((u) => u.via("access.sliceUpper")),
    tok(":").via("access.sliceStepColon"),
    $.children.split(":").at(2).andThen((s) => s.via("access.sliceStep")),
  ],
  // Parentheses ruff keeps, around the content its caller passes (`ctx.args.content`, with the comments after the
  // `(` in `ctx.args.dangling`); the ones it drops or adds never reach this rule.
  parenthesized_expression: ($) => ["(", $.children.via("access.parenthesized"), ")"],
  // An annotation's wrapper, whose expression ruff reads in its place.
  type: ($) => $.children,
  list_splat: ($) => ["*", $.children.via("access.starredValue")],
  dictionary_splat: ($) => ["**", $.children.via("access.starredValue")],
  keyword_argument: ($) => [$.name, "=", $.value.via("access.keywordValue")],
  splat_type:($) => ["*", "**", $.children.via("access.starredValue")],
} satisfies Structure;
