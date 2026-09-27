// Calls, attributes, subscripts, slices, parenthesized expressions, expression lists, splats, and types.
import type { Structure } from "../format.js";

export const exprAccess = {
  list_splat: ($) => ["*", $.children.via("access.starredValue")],
  dictionary_splat: ($) => ["**", $.children.via("access.starredValue")],
  splat_type: ($) => ["*", "**", $.children.via("access.starredValue")],
} satisfies Structure;
