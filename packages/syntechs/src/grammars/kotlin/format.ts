// Kotlin's layout in the formatter DSL (src/fmt/dsl/dsl.ts), as ktfmt 0.64 `--kotlinlang-style` prints it;
// `pnpm generate` compiles it into fmt.gen.ts. The grammar has no fields, so every kind lays out its children in
// source order (`inOrder`), and a kind with no rule here leaves the file unformatted (`unknown: "bail"`).
import {
  all,
  any,
  bail,
  defineFormat,
  either,
  group,
  grpBrace,
  grpParen,
  hardline,
  has,
  indent,
  inOrder,
  isEmpty,
  kindIs,
  lastItem,
  lines,
  not,
  prevItem,
  sepBy,
  space,
  spansLines,
  text,
  verbatim,
  when,
} from "../../fmt/dsl/dsl.js";
import type { grammar } from "./bundle.js";
import type { KotlinOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, KotlinOptions>();

// No space touching these: calls, member access, generic arguments, parameter lists.
const before = [
  ",",
  ")",
  "]",
  ".",
  "?.",
  "::",
  "value_arguments",
  "call_suffix",
  "navigation_suffix",
  "indexing_suffix",
  "type_arguments",
  "function_value_parameters",
] as const;
const after = ["(", "[", ".", "?.", "::"] as const;

/** Children joined by spaces, but around the punctuation in `before`/`after` and the extra kinds given. */
const spaced = (o: { readonly tightBefore?: readonly string[]; readonly braces?: boolean; readonly hang?: boolean } = {}) =>
  inOrder({
    join: "space",
    tight: { before: [...before, ...(o.tightBefore ?? [])] as never[], after: [...after, "modifiers"] as never[] },
    ...(o.braces ? { braces: true } : {}),
    ...(o.hang ? { hangAfter: ["=", "+=", "-=", "*=", "/=", "%="] as never[] } : {}),
  });

/** Adjacent children, with a space after each `,`. */
const adjacent = inOrder({ spaceWhen: { after: [","] } });

const binary = () => inOrder(space);

// ktfmt puts a blank line before every declaration of a file or class body but between two properties (or two file
// annotations), where it keeps the source's.
const blank = not(
  any(
    all(kindIs("property_declaration"), prevItem(kindIs("property_declaration"))),
    all(kindIs("file_annotation"), prevItem(kindIs("file_annotation"))),
  ),
);


export const kotlin = format({
  structure: {
    source_file: ($) => lines($.children, { blank }),
    package_header: () => inOrder(space),
    import_list: ($) => lines($.children),
    import_header: () => spaced(),
    import_alias: () => inOrder(space),
    identifier: () => inOrder(),
    file_annotation: () => inOrder(),
    statements: ($) => lines($.children),

    modifiers: () =>
      either(
        when("annotationsBreak"),
        [inOrder({ join: "space", hardWhen: { after: ["annotation"] } }), either(lastItem(kindIs("annotation")), hardline, space)],
        [inOrder(space), space],
      ),
    annotation: () => inOrder({ tight: { after: ["@", "[", "use_site_target"] }, spaceWhen: { before: ["user_type"] } }),
    use_site_target: () => inOrder(),

    class_declaration: () => spaced({ tightBefore: ["type_parameters", "primary_constructor"] }),
    object_declaration: () => spaced(),
    companion_object: () => spaced(),
    class_body: ($) =>
      either(isEmpty, ["{", "}"], ["{", indent([hardline, lines($.children, { blank })]), hardline, "}"]),
    enum_class_body: ($) =>
      either(
        any(has("children", "function_declaration"), has("children", "property_declaration")),
        bail("an enum body with members"),
        grpBrace(sepBy(",", $.children, { trailing: true })),
      ),
    enum_entry: () => spaced(),
    primary_constructor: ($) =>
      either(has("children", "modifiers"), bail("a primary constructor with modifiers"), grpParen(sepBy(",", $.children, { trailing: true }))),
    class_parameter: () => spaced({ tightBefore: [":"] }),
    delegation_specifier: () => spaced(),
    constructor_invocation: () => inOrder(),
    secondary_constructor: () => spaced({ braces: true }),
    constructor_delegation_call: () => inOrder(),
    type_alias: () => spaced({ tightBefore: ["type_parameters"] }),

    function_declaration: () => spaced({ tightBefore: [":"] }),
    function_value_parameters: ($) =>
      either(has("children", "parameter_modifiers"), bail("parameter modifiers"), grpParen(sepBy(",", $.children, { trailing: true }))),
    parameter: () => spaced({ tightBefore: [":"] }),
    function_body: () => spaced({ braces: true, hang: true }),
    anonymous_function: () => spaced({ tightBefore: [":"] }),
    property_declaration: () =>
      inOrder({
        join: "space",
        tight: { before: [...before, ":"] as never[], after: [...after, "modifiers"] as never[] },
        hangAfter: ["="],
        lineBefore: ["getter", "setter"],
      }),
    variable_declaration: () => spaced({ tightBefore: [":"] }),
    multi_variable_declaration: () => adjacent,
    getter: () => spaced({ tightBefore: [":", "("] }),
    setter: () => spaced({ tightBefore: [":", "("] }),

    user_type: () => inOrder(),
    nullable_type: () => inOrder(),
    type_arguments: () => adjacent,
    type_parameters: () => adjacent,
    type_parameter: () => inOrder(space),
    type_projection: () => inOrder(space),
    function_type: () => spaced(),
    function_type_parameters: () => adjacent,
    parenthesized_type: () => inOrder(),
    type_modifiers: () => inOrder(space),

    assignment: () => spaced({ hang: true }),
    directly_assignable_expression: () => inOrder(),
    call_expression: () => inOrder(),
    call_suffix: () => inOrder({ spaceWhen: { before: ["annotated_lambda"] } }),
    value_arguments: ($) => grpParen(sepBy(",", $.children, { trailing: true })),
    value_argument: () => inOrder({ join: "space", tight: { after: ["*"] } }),
    annotated_lambda: () => inOrder(space),
    lambda_literal: () =>
      either(
        isEmpty,
        ["{", "}"],
        group(inOrder({ join: "line", hangAfter: ["{", "->"], spaceWhen: { before: ["->"] } })),
      ),
    lambda_parameters: () => adjacent,
    navigation_expression: () => inOrder(),
    navigation_suffix: () => inOrder(),
    indexing_expression: () => inOrder(),
    indexing_suffix: () => adjacent,
    parenthesized_expression: () => inOrder(),
    prefix_expression: () => inOrder(),
    postfix_expression: () => inOrder(),
    this_expression: () => inOrder(),
    super_expression: () => inOrder(),
    callable_reference: () => inOrder(),
    jump_expression: () => inOrder(space),
    additive_expression: binary,
    multiplicative_expression: binary,
    comparison_expression: binary,
    equality_expression: binary,
    conjunction_expression: binary,
    disjunction_expression: binary,
    elvis_expression: binary,
    infix_expression: binary,
    as_expression: binary,
    check_expression: binary,
    range_expression: () => inOrder(),
    type_test: () => inOrder(space),

    if_expression: () => spaced(),
    control_structure_body: () => inOrder({ braces: true }),
    when_expression: () => spaced({ braces: true }),
    when_subject: () => spaced(),
    when_entry: () => spaced(),
    when_condition: () => inOrder(space),
    for_statement: () => spaced(),
    while_statement: () => spaced(),

    string_literal: () => text("trimEnd"),
    character_literal: () => verbatim,
  },
  wrapping: {
    source_file: { blankLines: "force" },
    class_body: { blankLines: "force" },
    statements: { blankLines: "force" },
    enum_class_body: { expand: "always" },
    value_arguments: { breakWhen: spansLines },
    function_value_parameters: { breakWhen: spansLines },
    primary_constructor: { breakWhen: spansLines },
  },
  unknown: "bail",
});
