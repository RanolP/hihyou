// JS, TS and TSX's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts.
// Typed against the tsx grammar, whose kinds and fields hold JS's and TS's. A kind whose layout is one of
// prettier's heuristics (member chains, argument expansion, assignment layout, JSX, conditional groups) is a
// `custom` rule, or a child printed `.via` one, written against sink.ts; the kinds not yet here still print by
// the Doc rules of print/**.
import { custom, defineFormat, inOrder, space } from "../../fmt/dsl/dsl.js";
import type { grammar } from "../tsx/bundle.js";
import type { JsOptions } from "./print/util.js";

const format = defineFormat<typeof grammar, JsOptions>();

/** JS, TS and TSX as prettier 3.9.9 lays them out. */
export const javascript = format({
  structure: {
    finally_clause: ($) => ["finally", space, $.body],

    update_expression: () => inOrder(),
    yield_expression: ($) => ["yield", "*", $.children.andThen((a) => [space, a])],
    unary_expression: () => custom("unary"),
    await_expression: () => custom("await"),
    sequence_expression: () => custom("sequence"),
    ternary_expression: () => custom("ternary"),
    conditional_type: () => custom("ternary"),

    // TypeScript types (print/types.ts holds the customs).
    literal_type: ($) => $.children,
    type_annotation: ($) => [":", space, $.children],
    opting_type_annotation: ($) => ["?:", space, $.children],
    omitting_type_annotation: ($) => ["-?:", space, $.children],
    adding_type_annotation: ($) => ["+?:", space, $.children],
    type_predicate_annotation: ($) => [":", space, $.children],
    asserts_annotation: ($) => [":", space, $.children],
    asserts: () => inOrder(space),
    type_predicate: ($) => [$.name, space, "is", space, $.type],
    array_type: ($) => [$.children, "[", "]"],
    lookup_type: () => inOrder(),
    optional_type: ($) => [$.children, "?"],
    rest_type: ($) => ["...", $.children],
    generic_type: ($) => [$.name, $.type_arguments],
    type_query: ($) => ["typeof", space, $.children],
    index_type_query: () => inOrder(space),
    readonly_type: () => inOrder(space),
    template_literal_type: () => inOrder(),
    template_type: ($) => ["${", $.children, "}"],
    enum_declaration: () => inOrder(space),
    parenthesized_type: () => custom("parenthesizedType"),
    infer_type: () => custom("inferType"),
    intersection_type: () => custom("intersectionType"),
    type_parameters: () => custom("typeParameters"),
    type_arguments: () => custom("typeParameters"),
    type_parameter: () => custom("typeParameter"),
    ambient_declaration: () => custom("ambientDeclaration"),
    as_expression: () => custom("castExpression"),
    satisfies_expression: () => custom("castExpression"),

    object: () => custom("object"),
    object_pattern: () => custom("object"),
    enum_body: () => custom("object"),
    object_assignment_pattern: ($) => [$.left, space, "=", space, $.right],
    computed_property_name: ($) => ["[", $.children, "]"],
    spread_element: ($) => ["...", $.children],
    rest_pattern: ($) => ["...", $.children],

    class: () => custom("class"),
    class_declaration: () => custom("class"),
    abstract_class_declaration: () => custom("class"),
    interface_declaration: () => custom("class"),
    class_static_block: ($) => ["static", space, $.body],
    decorator: ($) => ["@", $.children],
  },
});
