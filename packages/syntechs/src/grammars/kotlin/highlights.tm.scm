; Patterns appended after tree-sitter-kotlin's highlight query, for the tokens VS Code's Kotlin TextMate grammar
; scopes differently from it. A pattern here wins over an upstream one on the same node. The scopes each capture
; paints are in src/highlight/rules.node.ts.

(package_header "package" @keyword)
(import_header (identifier) @namespace)
(import_header "." @namespace)
(wildcard_import "*" @variable.wildcard)
(string_literal "$" @string.template (interpolated_identifier) @string.template)
(anonymous_initializer "init" @keyword.soft)
(catch_block "catch" @keyword.soft)
(finally_block "finally" @keyword.soft)
["?." "?:" "::"] @punctuation.delimiter
"->" @operator.arrow

; A name after `fun`, whatever modifiers come first (upstream anchors it as the first named child).
(function_declaration (simple_identifier) @function)
; VS Code's grammar takes these soft keywords for modifiers wherever they appear.
(simple_identifier "value" @keyword)
(companion_object "companion" @keyword)
(platform_modifier) @none
; Type syntax VS Code's grammar leaves unscoped, or scopes as the type after a `:`.
(type_arguments ["<" ">"] @punctuation.bracket)
(type_parameters ["<" ">"] @punctuation.bracket)
(function_type "->" @none)
(type_modifiers) @type
(callable_reference (type_identifier) @none "class" @type)
(this_expression (type_identifier) @variable.builtin)
; A word before `(` is a call to VS Code's grammar.
(enum_entry (simple_identifier) @function (value_arguments))
(jump_expression (label) @none)
(jump_expression "null" @boolean)
