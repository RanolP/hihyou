; Patterns appended after nvim-treesitter's XML highlight query, for the tokens VS Code's XML grammar scopes
; differently from it. A pattern here wins over an upstream one on the same node. The scopes each capture paints
; are in src/highlight/rules.node.ts.

; A string's closing quote; upstream paints both quotes alike. An anchor passes over anonymous nodes, so this
; tells the quotes apart only in a string holding a named node: the XML declaration's values, an entity's value
; and a public ID keep both quotes the opening one's scope.
(AttValue ["\"" "'"] @punctuation.delimiter.end .)
(PseudoAttValue ["\"" "'"] @punctuation.delimiter.end .)
(SystemLiteral ["\"" "'"] @punctuation.delimiter.end .)

; A CDATA section is one string, its `<![CDATA[` and `]]>` included.
(CDSect) @markup.raw
(CDSect (CData) @markup.raw.text)

; A processing instruction's target, which upstream paints with the rest of the instruction.
(PI (PITarget) @keyword.directive.target)

; The `&` and `;` around an entity or character reference, and the `%` and `;` around a parameter entity.
(EntityRef ["&" ";"] @punctuation.entity)
(CharRef ["&#" "&#x" ";"] @punctuation.entity)
(PEReference ["%" ";"] @punctuation.entity)
