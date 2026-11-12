; Patterns appended after nvim-treesitter's HCL and Terraform highlight queries, for the tokens HashiCorp's Terraform
; TextMate grammar scopes differently from them. A pattern here wins over an upstream one on the same node. The
; scopes each capture paints are in src/highlight/rules.node.ts.

; A word spelling a type (`map`, `string`) is a name like any other: upstream's Terraform query colours it a type
; wherever it stands, `var.map` and `for string in ...` included. The type positions follow below.
((identifier) @variable
  (#any-of? @variable "bool" "string" "number" "object" "tuple" "list" "map" "set" "any"))

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

; A reference: its root is a plain name (`v.name` in a `for`, `aws_instance.web.id`) unless Terraform or
; Terragrunt defines it, and every name after a `.` is a member. Upstream calls any root a built-in and colours
; `path.module`'s `module` as one. An operand of an operator is no `expression` of its own, so any parent goes.
(_ (variable_expr (identifier) @variable) . (get_attr))
((_ (variable_expr (identifier) @variable.builtin) . (get_attr))
  (#any-of? @variable.builtin
    "var" "local" "each" "path" "module" "data" "count" "self" "terraform" "dependency" "include"))
(get_attr (identifier) @variable.member)

; A type in a type position: an attribute `type = ...` (a `variable`'s type constraint), a type constructor
; `map(...)`, `list(...)`, and a type word inside one or inside `optional(...)`, including an `object({ k = T })`
; attribute's type and a `tuple([T, ...])` element's.
((attribute (identifier) @_name (expression (variable_expr (identifier) @type.builtin)))
  (#eq? @_name "type")
  (#any-of? @type.builtin "bool" "string" "number" "any" "list" "map" "set" "object" "tuple"))
((function_call (identifier) @type.builtin)
  (#any-of? @type.builtin "list" "map" "set" "object" "tuple"))
((function_call (identifier) @_ctor (function_arguments (expression (variable_expr (identifier) @type.builtin))))
  (#any-of? @_ctor "list" "map" "set" "optional")
  (#any-of? @type.builtin "bool" "string" "number" "any" "list" "map" "set" "object" "tuple"))
((function_call (identifier) @_ctor
  (function_arguments (expression (collection_value (object (object_elem
    val: (expression (variable_expr (identifier) @type.builtin))))))))
  (#eq? @_ctor "object")
  (#any-of? @type.builtin "bool" "string" "number" "any" "list" "map" "set" "object" "tuple"))
((function_call (identifier) @_ctor
  (function_arguments (expression (collection_value (tuple (expression (variable_expr (identifier) @type.builtin)))))))
  (#eq? @_ctor "tuple")
  (#any-of? @type.builtin "bool" "string" "number" "any" "list" "map" "set" "object" "tuple"))

; A heredoc's body.
(heredoc_template (template_literal) @string.heredoc)

; A number with a fraction or an exponent, which HashiCorp's grammar scopes as a float.
((numeric_lit) @number.float
  (#match? @number.float "^[0-9]+([.]|[eE])"))
