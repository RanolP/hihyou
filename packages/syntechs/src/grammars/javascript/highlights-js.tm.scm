; Patterns appended after javascript/highlights.tm.scm for JavaScript's own syntax, where TypeScript's grammar
; names the node differently (typescript/highlights.tm.scm has its counterparts). The scopes each capture paints
; are in src/highlight/rules.node.ts.

(field_definition property: (property_identifier) @property.declaration)
(field_definition
  property: (property_identifier) @function.method
  value: [(function_expression) (arrow_function) (generator_function)])
