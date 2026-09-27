// Strings: literals, concatenations, and f-string interpolations.
import { custom } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

// A string's quotes, escapes, docstring and concatenation layout are all ruff's heuristics: one custom prints it.
export const string = {
  string: () => custom("string.str"),
  concatenated_string: () => custom("string.str"),
} satisfies Structure;
