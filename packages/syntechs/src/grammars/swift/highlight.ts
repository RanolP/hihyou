// tree-sitter-swift 0.7.3's queries/highlights.scm, in its order, as rules for the shared highlighter. Two
// patterns are looser here than there: an attribute's `@` and type are captured by their parents alone, without
// requiring each other as siblings, and `@comment @spell` keeps only `@comment`.

import {
  createHighlighter,
  type Highlighter,
  type ScopeRule,
} from "../../highlight/index.js";

const up = (...kinds: string[]) => kinds.map((kind) => ({ kind }));

const RULES: ScopeRule[] = [
  { tokens: [".", ";", ":", ","], capture: "punctuation.delimiter" },
  { tokens: ["(", ")", "[", "]", "{", "}"], capture: "punctuation.bracket" },
  // Identifiers
  { kinds: ["type_identifier"], capture: "type" },
  { kinds: ["self_expression", "super_expression"], capture: "variable.builtin" },
  // Declarations
  { tokens: ["func", "deinit"], capture: "keyword.function" },
  {
    kinds: [
      "visibility_modifier",
      "member_modifier",
      "function_modifier",
      "property_modifier",
      "parameter_modifier",
      "inheritance_modifier",
      "mutation_modifier",
    ],
    capture: "keyword.modifier",
  },
  { kinds: ["simple_identifier"], capture: "variable" },
  { kinds: ["simple_identifier"], up: up("function_declaration"), capture: "function.method" },
  {
    kinds: ["simple_identifier"],
    field: "name",
    up: up("protocol_function_declaration"),
    capture: "function.method",
  },
  { tokens: ["init"], up: up("init_declaration"), capture: "constructor" },
  { kinds: ["simple_identifier"], field: "external_name", up: up("parameter"), capture: "variable.parameter" },
  { kinds: ["simple_identifier"], field: "name", up: up("parameter"), capture: "variable.parameter" },
  { kinds: ["type_identifier"], up: up("type_parameter"), capture: "variable.parameter" },
  { kinds: ["simple_identifier"], up: up("identifier", "inheritance_constraint"), capture: "variable.parameter" },
  { kinds: ["simple_identifier"], up: up("identifier", "equality_constraint"), capture: "variable.parameter" },
  {
    tokens: [
      "protocol", "extension", "indirect", "nonisolated", "override", "convenience", "required", "some", "any",
      "weak", "unowned", "didSet", "willSet", "subscript", "let", "var",
    ],
    kinds: [
      "throws",
      "where_keyword",
      "getter_specifier",
      "setter_specifier",
      "modify_specifier",
      "else",
      "as_operator",
    ],
    capture: "keyword",
  },
  { tokens: ["enum", "struct", "class", "typealias"], capture: "keyword.type" },
  { tokens: ["async", "await"], capture: "keyword.coroutine" },
  { kinds: ["shebang_line"], capture: "keyword.directive" },
  {
    kinds: ["simple_identifier"],
    up: up("pattern", "property_declaration", "class_body"),
    capture: "variable.member",
  },
  { kinds: ["simple_identifier"], up: up("pattern", "protocol_property_declaration"), capture: "variable.member" },
  { kinds: ["simple_identifier"], up: up("navigation_suffix", "navigation_expression"), capture: "variable.member" },
  {
    kinds: ["simple_identifier"],
    up: [{ kind: "value_argument_label", field: "name" }, { kind: "value_argument" }],
    capture: "variable.member",
  },
  { tokens: ["import"], up: up("import_declaration"), capture: "keyword.import" },
  { tokens: ["case"], up: up("enum_entry"), capture: "keyword" },
  { tokens: ["@"], up: up("attribute", "modifiers"), capture: "attribute" },
  { kinds: ["type_identifier"], up: up("user_type", "attribute", "modifiers"), capture: "attribute" },
  // Function calls
  { kinds: ["simple_identifier"], up: up("call_expression"), capture: "function.call" },
  {
    kinds: ["simple_identifier"],
    up: up("navigation_suffix", "navigation_expression", "call_expression"),
    capture: "function.call",
  },
  { kinds: ["simple_identifier"], up: up("prefix_expression", "call_expression"), capture: "function.call" },
  { kinds: ["simple_identifier"], up: up("navigation_expression"), match: /^[A-Z]/, capture: "type" },
  { kinds: ["directive"], capture: "keyword.directive" },
  {
    kinds: [
      "diagnostic",
      "availability_condition",
      "playground_literal",
      "key_path_string_expression",
      "selector_expression",
      "external_macro_definition",
    ],
    capture: "function.macro",
  },
  { kinds: ["special_literal"], capture: "constant.macro" },
  // Statements
  { tokens: ["for", "in"], up: up("for_statement"), capture: "keyword.repeat" },
  { tokens: ["while", "repeat", "continue", "break"], capture: "keyword.repeat" },
  { tokens: ["guard"], up: up("guard_statement"), capture: "keyword.conditional" },
  { tokens: ["if"], up: up("if_statement"), capture: "keyword.conditional" },
  { tokens: ["switch"], up: up("switch_statement"), capture: "keyword.conditional" },
  { tokens: ["case", "fallthrough"], up: up("switch_entry"), capture: "keyword" },
  { kinds: ["default_keyword"], up: up("switch_entry"), capture: "keyword" },
  { tokens: ["return"], capture: "keyword.return" },
  { tokens: ["?", ":"], up: up("ternary_expression"), capture: "keyword.conditional.ternary" },
  { kinds: ["try_operator", "throw_keyword", "catch_keyword"], tokens: ["do"], capture: "keyword.exception" },
  { kinds: ["statement_label"], capture: "label" },
  // Comments
  { kinds: ["comment", "multiline_comment"], capture: "comment" },
  { kinds: ["comment"], match: /^\/\/\/[^/]/, capture: "comment.documentation" },
  { kinds: ["comment"], match: /^\/\/\/$/, capture: "comment.documentation" },
  { kinds: ["multiline_comment"], match: /^\/[*][*][^*].*[*]\/$/, capture: "comment.documentation" },
  // String literals
  { kinds: ["line_str_text", "multi_line_str_text", "raw_str_part", "raw_str_end_part"], capture: "string" },
  { kinds: ["str_escaped_char"], capture: "string.escape" },
  { tokens: ["\\(", ")"], up: up("line_string_literal"), capture: "punctuation.special" },
  { tokens: ["\\(", ")"], up: up("multi_line_string_literal"), capture: "punctuation.special" },
  { kinds: ["raw_str_interpolation_start"], up: up("raw_str_interpolation"), capture: "punctuation.special" },
  { tokens: [")"], up: up("raw_str_interpolation"), capture: "punctuation.special" },
  { tokens: ['"', '"""'], capture: "string" },
  // Lambda literals
  { tokens: ["in"], up: up("lambda_literal"), capture: "keyword.operator" },
  // Basic literals
  { kinds: ["integer_literal", "hex_literal", "oct_literal", "bin_literal"], capture: "number" },
  { kinds: ["real_literal"], capture: "number.float" },
  { kinds: ["boolean_literal"], capture: "boolean" },
  { tokens: ["nil"], capture: "constant.builtin" },
  { kinds: ["wildcard_pattern"], capture: "character.special" },
  { kinds: ["regex_literal"], capture: "string.regexp" },
  // Operators
  { kinds: ["custom_operator", "bang"], capture: "operator" },
  {
    tokens: [
      "+", "-", "*", "/", "%", "=", "+=", "-=", "*=", "/=", "<", ">", "<<", ">>", "<=", ">=", "++", "--", "^", "&",
      "&&", "|", "||", "~", "%=", "!=", "!==", "==", "===", "?", "??", "->", "..<", "...",
    ],
    capture: "operator",
  },
  { tokens: ["<", ">"], up: up("type_arguments"), capture: "punctuation.bracket" },
];

export const highlight: Highlighter = createHighlighter(RULES, "swift");
