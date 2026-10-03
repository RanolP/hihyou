import type { ScopeRules } from "../../diff/scope.js";

const functions = [
  "function_declaration",
  "function_expression",
  "generator_function_declaration",
  "generator_function",
  "arrow_function",
  "method_definition",
  "class_static_block",
];

/** Lexical scoping of JavaScript: parameters, `let`/`const`, `catch` and loop variables; `var` is never certain. */
export const scope: ScopeRules = {
  references: ["identifier"],
  inert: [
    "property_identifier",
    "private_property_identifier",
    "statement_identifier",
    "string_fragment",
    "escape_sequence",
    "regex_pattern",
    "regex_flags",
    "number",
    "jsx_text",
    "html_comment",
    "hash_bang_line",
    "this",
    "super",
    "true",
    "false",
    "null",
    "undefined",
  ],
  blocks: [
    "statement_block",
    "for_statement",
    "for_in_statement",
    "switch_body",
    "program",
  ],
  module: ["program"],
  functions,
  exports: ["export_statement"],
  binders: [
    { holder: "formal_parameters", scope: 1 },
    { holder: "arrow_function", field: "parameter", scope: 0 },
    { holder: "catch_clause", field: "parameter", scope: 0 },
    {
      holder: "variable_declarator",
      field: "name",
      parent: "lexical_declaration",
      scope: "block",
    },
    {
      holder: "for_in_statement",
      field: "left",
      kind: ["let", "const"],
      scope: 0,
    },
    // A declaration's own name shadows what it spells but is never renamed.
    {
      holder: "function_declaration",
      field: "name",
      scope: "block",
      opaque: true,
    },
    {
      holder: "generator_function_declaration",
      field: "name",
      scope: "block",
      opaque: true,
    },
    {
      holder: "class_declaration",
      field: "name",
      scope: "block",
      opaque: true,
    },
    { holder: "function_expression", field: "name", scope: 0, opaque: true },
    { holder: "generator_function", field: "name", scope: 0, opaque: true },
    { holder: "class", field: "name", scope: 0, opaque: true },
  ],
  patterns: {
    object_pattern: [null],
    array_pattern: [null],
    rest_pattern: [null],
    pair_pattern: ["value"],
    assignment_pattern: ["left"],
    object_assignment_pattern: ["left"],
  },
  keyed: ["shorthand_property_identifier_pattern"],
  nonReferences: [
    { holder: "jsx_opening_element", field: "name" },
    { holder: "jsx_closing_element", field: "name" },
    { holder: "jsx_self_closing_element", field: "name" },
  ],
  uncertain: [
    { kind: "variable_declaration" },
    { kind: "for_in_statement", field: "kind", label: "var" },
    { kind: "with_statement" },
    { kind: "call_expression", field: "function", label: "eval" },
    // Annex B hoists a function declared in a block to its function, past the block's scope.
    { kind: "function_declaration", nested: true },
    { kind: "generator_function_declaration", nested: true },
  ],
};
