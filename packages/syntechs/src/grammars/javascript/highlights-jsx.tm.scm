; Patterns appended after javascript/highlights.tm.scm for the grammars with JSX (javascript, tsx). The scopes
; each capture paints are in src/highlight/rules.node.ts.

; JSX: a capitalised or dotted element name is a component.
(jsx_opening_element name: (identifier) @tag.component (#match? @tag.component "^[A-Z]"))
(jsx_closing_element name: (identifier) @tag.component (#match? @tag.component "^[A-Z]"))
(jsx_self_closing_element name: (identifier) @tag.component (#match? @tag.component "^[A-Z]"))
(jsx_opening_element name: (member_expression object: (_) @tag.component property: (_) @tag.component))
(jsx_closing_element name: (member_expression object: (_) @tag.component property: (_) @tag.component))
(jsx_self_closing_element name: (member_expression object: (_) @tag.component property: (_) @tag.component))
