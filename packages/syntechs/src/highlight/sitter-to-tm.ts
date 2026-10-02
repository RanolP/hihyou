// The one hand-written part of highlighting: each tree-sitter (nvim-treesitter) capture name as a TextMate scope,
// before the language suffix. Every highlighter is generated from its grammar's queries/highlights.scm and maps
// its captures through this table. A capture missing here falls back to its nearest listed prefix
// (`keyword.conditional.ternary` → `keyword.conditional`); `null` marks a capture that is not a highlight
// (`@spell`), which the highlighter skips.
export const SITTER_TO_TM: Record<string, string | null> = {
  attribute: "storage.modifier.attribute",
  boolean: "constant.language.boolean",
  "character.special": "variable.language.wildcard",
  comment: "comment",
  "comment.documentation": "comment.block.documentation",
  "constant.builtin": "constant.language",
  "constant.macro": "constant.language",
  constructor: "entity.name.function.constructor",
  "function.call": "entity.name.function",
  "function.macro": "entity.name.function.preprocessor",
  "function.method": "entity.name.function",
  keyword: "keyword.other",
  "keyword.conditional": "keyword.control.conditional",
  "keyword.conditional.ternary": "keyword.operator.ternary",
  "keyword.coroutine": "keyword.control.async",
  "keyword.directive": "keyword.control.directive",
  "keyword.exception": "keyword.control.exception",
  "keyword.function": "storage.type.function",
  "keyword.import": "keyword.control.import",
  "keyword.modifier": "storage.modifier",
  "keyword.operator": "keyword.operator",
  "keyword.repeat": "keyword.control.loop",
  "keyword.return": "keyword.control.return",
  "keyword.type": "storage.type",
  label: "entity.name.label",
  nospell: null,
  number: "constant.numeric.integer",
  "number.float": "constant.numeric.float",
  operator: "keyword.operator",
  "punctuation.bracket": "punctuation.section.brackets",
  "punctuation.delimiter": "punctuation.separator",
  "punctuation.special": "punctuation.section.embedded",
  spell: null,
  string: "string.quoted",
  "string.escape": "constant.character.escape",
  "string.regexp": "string.regexp",
  type: "entity.name.type",
  variable: "variable.other",
  "variable.builtin": "variable.language",
  "variable.member": "variable.other.member",
  "variable.parameter": "variable.parameter",
};

/** A capture's TextMate scope; `null` for a non-highlight capture, `undefined` for one the table lacks. */
export function tmScopeOf(capture: string): string | null | undefined {
  if (capture.startsWith("_")) return null; // nvim-treesitter's private captures
  for (let c = capture; ; ) {
    const scope = SITTER_TO_TM[c];
    if (scope !== undefined) return scope;
    const dot = c.lastIndexOf(".");
    if (dot < 0) return undefined;
    c = c.slice(0, dot);
  }
}
