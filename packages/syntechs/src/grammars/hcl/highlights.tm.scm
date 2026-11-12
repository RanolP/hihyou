; Patterns appended after nvim-treesitter's HCL and Terraform highlight queries, for the tokens HashiCorp's Terraform
; TextMate grammar scopes differently from them. A pattern here wins over an upstream one on the same node. The
; scopes each capture paints are in src/highlight/rules.node.ts.

; A block's type: top-level (`resource`, `variable`) or nested (`lifecycle`). grammar.patch keeps the top level
; out of a `body`, which upstream's patterns go by.
(config_file (block (identifier) @keyword))
(body (block (identifier) @type))

; An attribute's name, and an object key written as a bare word, even one spelling a type (`map = ...`).
(attribute (identifier) @variable.declaration)
(object_elem key: (expression (variable_expr (identifier) @variable.declaration)))

; A block's labels, quoted or bare: `resource "aws_instance" "web"`. The type comes first.
(block (string_lit (quoted_template_start) @label))
(block (string_lit (template_literal) @label))
(block (string_lit (quoted_template_end) @label))
(block (_) (identifier) @label)

; A heredoc's body.
(heredoc_template (template_literal) @string.heredoc)

; A number with a fraction or an exponent, which HashiCorp's grammar scopes as a float.
((numeric_lit) @number.float
  (#match? @number.float "^[0-9]+([.]|[eE])"))
