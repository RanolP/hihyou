// Strings: literals, concatenations, and f-string interpolations.
import { custom, verbatim } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

// A part's quotes are chosen once for the whole part (ruff's `FStringContext`), so the part's custom hands them to
// each leaf as its args; the leaves print by them. A concatenation's layout is ruff's heuristics, one custom.
export const string = {
  string: () => custom("string.part"),
  string_start: () => custom("string.start"),
  string_content: () => custom("string.content"),
  string_end: () => custom("string.end"),
  interpolation: () => custom("string.interpolation"),
  type_conversion: () => verbatim,
  format_specifier: () => verbatim,
  // Unreached: string_content prints its own text and format_specifier prints verbatim, neither descending here.
  escape_sequence: () => verbatim,
  escape_interpolation: () => verbatim,
  format_expression: () => verbatim,
  concatenated_string: () => custom("string.concatenated"),
} satisfies Structure;
