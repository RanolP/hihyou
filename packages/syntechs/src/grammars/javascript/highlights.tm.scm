; Patterns appended after tree-sitter-javascript's highlight queries (and TypeScript's), for the tokens VS Code's
; TextMate grammar scopes that the upstream queries leave uncaptured or capture more coarsely. A pattern here wins
; over an upstream one on the same node; within this file, a later pattern wins over an earlier one. The scopes
; each capture paints are in src/highlight/rules.node.ts.

; Names VS Code's grammar leaves plain where the upstream queries scope them: an all-caps name starting with `_`,
; `require` that is not called.
([
    (identifier)
    (shorthand_property_identifier)
    (shorthand_property_identifier_pattern)
 ] @variable
 (#match? @variable "^_+[A-Z\\d][A-Z\\d_]*$"))
((identifier) @variable
 (#eq? @variable "require"))

; Constants: an all-caps name, a `const` binding.
((identifier) @constant
 (#match? @constant "^[A-Z][_$\\dA-Z]*$"))
((property_identifier) @constant.property
 (#match? @constant.property "^#?[A-Z][_$\\dA-Z]*$"))
((property_identifier) @support.property
 (#any-of? @support.property "length" "prototype" "constructor"))
(lexical_declaration "const" (variable_declarator name: (identifier) @constant))
(lexical_declaration "const"
  (variable_declarator name: [
    (object_pattern (shorthand_property_identifier_pattern) @constant)
    (object_pattern (pair_pattern value: (identifier) @constant))
    (array_pattern (identifier) @constant)
    (array_pattern (object_pattern (shorthand_property_identifier_pattern) @constant))
    (array_pattern (rest_pattern (identifier) @constant))
    (object_pattern (rest_pattern (identifier) @constant))
    (object_pattern (object_assignment_pattern left: (shorthand_property_identifier_pattern) @constant))
  ]))
(for_in_statement "const" left: [
    (identifier) @constant
    (array_pattern (identifier) @constant)
    (object_pattern (shorthand_property_identifier_pattern) @constant)
    (object_pattern (pair_pattern value: (identifier) @constant))
    (array_pattern (object_pattern (shorthand_property_identifier_pattern) @constant))
  ])

; An imported or exported binding is an alias, whatever its case.
(import_clause (identifier) @variable.alias)
(import_specifier name: (identifier) @variable.alias)
(import_specifier alias: (identifier) @variable.alias)
(export_specifier name: (identifier) @variable.alias)
(export_specifier alias: (identifier) @variable.alias)
(namespace_import (identifier) @variable.alias)

; Parameters the upstream queries miss: with a default, rest, or nested in a pattern.
(formal_parameters (assignment_pattern left: (identifier) @variable.parameter))
(formal_parameters (rest_pattern (identifier) @variable.parameter))
(formal_parameters (object_pattern (object_assignment_pattern left: (shorthand_property_identifier_pattern) @variable.parameter)))
(formal_parameters (object_pattern (rest_pattern (identifier) @variable.parameter)))
(arrow_function parameter: (identifier) @variable.parameter)

; Declarations.
(statement_identifier) @label
(hash_bang_line) @comment
(pair key: (property_identifier) @property.key)
(pair_pattern key: (property_identifier) @property.declaration)
(function_declaration name: (identifier) @function)
(function_expression name: (identifier) @function)
(class name: (identifier) @type.class)
(class_declaration name: (identifier) @type.class)
(class_heritage (identifier) @type.inherited)
(binary_expression "instanceof" right: (identifier) @type)
(method_definition name: (property_identifier) @keyword.storage
 (#eq? @keyword.storage "constructor"))
(generator_function name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)

; Functions: what a call calls, what a binding holds.
(call_expression function: (identifier) @function)
(new_expression constructor: (identifier) @function)
(variable_declarator
  name: (identifier) @function
  value: [(function_expression) (arrow_function) (generator_function)])
(pair
  key: (property_identifier) @function.method
  value: [(function_expression) (arrow_function) (generator_function)])
(decorator "@" @punctuation.decorator)
(decorator (call_expression function: (identifier) @function.decorator))
(decorator (member_expression property: (property_identifier) @function.decorator))

; Globals VS Code's grammar names by their text.
((identifier) @support.class
 (#eq? @support.class "Promise"))
((identifier) @support.module
 (#eq? @support.module "exports"))
(member_expression
  object: (identifier) @_module
  property: (property_identifier) @support.module
  (#eq? @_module "module")
  (#eq? @support.module "exports"))
; A variable a file declares itself is not the CommonJS global.
(lexical_declaration "let" (variable_declarator name: (identifier) @variable (#eq? @variable "module")))

; Tokens.
(import_statement "import" @keyword)
(call_expression function: (import) @function)
(namespace_import "*" @constant.import-export-all)
(export_statement "*" @constant.import-export-all)
(regex "/" @string.regexp.delimiter)
(regex_flags) @string.regexp.flags
(escape_sequence) @string.escape
(ternary_expression ["?" ":"] @operator)
"..." @operator
(meta_property "meta" @support.property)
