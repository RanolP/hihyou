// The extras: comments and line continuations. The placement pass (fmt/comments.ts) attaches each comment to a
// node of ruff's AST, whose rules print it beside that node; a line continuation ruff drops, re-breaking the line.
import { custom } from "../../../fmt/dsl/dsl.js";
import type { Structure } from "../format.js";

export const trivia = {
  comment: () => custom("trivia.comment"),
  line_continuation: () => [],
} satisfies Structure;
