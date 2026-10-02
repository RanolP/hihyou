; Patterns appended after the TypeScript and JavaScript highlight queries and javascript/highlights.tm.scm, for
; TypeScript's own syntax. The scopes each capture paints are in src/highlight/rules.node.ts.
;
; tree-sitter-typescript's tree-sitter.json lists its own highlights.scm before JavaScript's, written for the
; first pattern winning; tree-sitter now lets the later pattern win, so JavaScript's generic patterns override
; TypeScript's specific ones. These restate them after it.
(type_arguments ["<" ">"] @punctuation.bracket)
(required_parameter pattern: [
    (identifier) @variable.parameter
    (rest_pattern (identifier) @variable.parameter)
    (array_pattern (identifier) @variable.parameter)
    (array_pattern (rest_pattern (identifier) @variable.parameter))
    (object_pattern (shorthand_property_identifier_pattern) @variable.parameter)
    (object_pattern (pair_pattern value: (identifier) @variable.parameter))
    (object_pattern (object_assignment_pattern left: (shorthand_property_identifier_pattern) @variable.parameter))
    (object_pattern (rest_pattern (identifier) @variable.parameter))
  ])
(optional_parameter pattern: (identifier) @variable.parameter)

(type_annotation ":" @operator)
(omitting_type_annotation ":" @operator)
(opting_type_annotation ":" @operator)
(asserts_annotation ":" @operator)
(type_predicate_annotation ":" @operator)
(index_signature ":" @operator)
(conditional_type ["?" ":"] @operator)
"?" @operator
["-?:" "+?:" "?:"] @operator
(type_parameters ["<" ">"] @punctuation.bracket)
(predefined_type _ @type.builtin)
(this_type) @variable.this
(nested_type_identifier module: (identifier) @type.module)
(nested_identifier object: (identifier) @type.module)
(type_predicate name: (identifier) @variable.parameter)

; Declarations.
(class_declaration name: (type_identifier) @type.class)
(abstract_class_declaration name: (type_identifier) @type.class)
(class name: (type_identifier) @type.class)
(extends_clause value: (identifier) @type.inherited)
(enum_body (property_identifier) @constant.enum)
(enum_assignment name: (property_identifier) @constant.enum)
(property_signature name: (property_identifier) @property.declaration)
(public_field_definition name: (property_identifier) @property.declaration)
(public_field_definition
  name: (property_identifier) @function.method
  value: [(function_expression) (arrow_function) (generator_function)])
(property_signature name: (property_identifier) @function.method type: (type_annotation (function_type)))
(public_field_definition name: (property_identifier) @function.method type: (type_annotation (function_type)))
(method_signature name: (property_identifier) @function.method)
(abstract_method_signature name: (property_identifier) @function.method)
(function_signature name: (identifier) @function)
(required_parameter pattern: (identifier) @function type: (type_annotation (function_type)))
(optional_parameter pattern: (identifier) @function type: (type_annotation (function_type)))
(variable_declarator name: (identifier) @function type: (type_annotation (function_type)))
(method_definition name: (property_identifier) @keyword.storage
 (#eq? @keyword.storage "constructor"))

; `a.b!(...)` still calls `b`.
(call_expression function: (non_null_expression (member_expression property: (property_identifier) @function.method)))
(call_expression function: (non_null_expression (identifier) @function))

(module "module" @keyword)
(using_declaration (variable_declarator name: (identifier) @constant))
