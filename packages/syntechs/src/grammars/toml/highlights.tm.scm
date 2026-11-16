; Patterns appended after nvim-treesitter's TOML highlight query, for the tokens Even Better TOML's TextMate grammar
; scopes differently from it. A pattern here wins over an upstream one on the same node. The scopes each capture
; paints are in src/highlight/rules.node.ts.

; A quoted key is a key like a bare one, not a string.
(quoted_key) @property

; A table header's key and its parts: `[dependencies]`, `[profile.release]`, `[target."cfg(unix)".dependencies]`.
; grammar.patch keeps a dotted key's parts as siblings, so one level reaches each.
(table key: [(bare_key) (quoted_key)] @property.table)
(table key: (dotted_key [(bare_key) (quoted_key)] @property.table))
(table_array_element key: [(bare_key) (quoted_key)] @property.array)
(table_array_element key: (dotted_key [(bare_key) (quoted_key)] @property.array))

; A table header's brackets; an array's stay the array's.
(table "[" @punctuation.bracket.table)
(table "]" @punctuation.bracket.table)

; A `,` between an inline table's pairs.
(inline_table "," @punctuation.delimiter.inline)
