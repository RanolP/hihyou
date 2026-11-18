; Patterns appended after tree-sitter-ini's highlight query, for the tokens grammar.patch adds and the ones VS Code's
; INI grammar scopes differently from it. A pattern here wins over an upstream one on the same node. The scopes each
; capture paints are in src/highlight/rules.node.ts.

; A section header whole, `[core]`, brackets included.
(section_name) @module

; A .properties `key: value`'s separator, like `=`.
(setting ":" @operator)

; A dotenv `export KEY=value`.
(export) @keyword

(string) @string

; A trailing `\` that continues a value onto the next line.
(line_continuation) @string.escape
