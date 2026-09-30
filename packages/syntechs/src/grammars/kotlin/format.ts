// Kotlin's layout in the formatter DSL (src/fmt/dsl/dsl.ts), as ktfmt 0.64 `--kotlinlang-style` prints it;
// `pnpm generate` compiles it into fmt.gen.ts. The grammar has no fields, so every kind lays out its children in
// source order (`inOrder`), and a kind with no rule here leaves the file unformatted (`unknown: "bail"`).
import {
  all,
  any,
  breakParent,
  custom,
  defineFormat,
  either,
  firstText,
  group,
  grpBracket,
  grpAngle,
  grpParen,
  hardline,
  has,
  indent,
  inOrder,
  isEmpty,
  kindIs,
  lastItem,
  line,
  lines,
  not,
  prevItem,
  sepBy,
  space,
  spansLines,
  splitOn,
  text,
  verbatim,
  when,
} from "../../fmt/dsl/dsl.js";
import { kdoc } from "../../fmt/dsl/doc-comment.js";
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
const spaced = (
  o: {
    readonly tightBefore?: readonly string[];
    readonly braces?: boolean;
    readonly hang?: boolean;
    /** The rule naming the right sides that stay on the `=`'s line (see `hug`). */
    readonly hug?: "hugged" | "huggedChain";
    readonly skip?: readonly string[];
  } = {},
) =>
  inOrder({
    join: "space",
    tight: { before: [...before, ...(o.tightBefore ?? [])] as never[], after: [...after, "modifiers"] as never[] },
    ...(o.braces ? { braces: true } : {}),
    ...(o.hang ? { hangAfter: ["=", "+=", "-=", "*=", "/=", "%="] as never[] } : {}),
    ...(o.hug ? { hug: when(o.hug) } : {}),
    ...(o.skip ? { skip: o.skip as never[] } : {}),
  });

/** Adjacent children, with a space after each `,`. */
const adjacent = inOrder({ spaceWhen: { after: [","] } });

const binary = () => inOrder(space);

// A parameter list's entries, `many` of them ending in a trailing comma while the list breaks. A lone parameter's
// only top-level comma is a written trailing one, which ktfmt drops.
const parameterList = (many: boolean) =>
  grpParen(
    splitOn(",", {
      except: many ? ["(", ")"] : ["(", ")", ","],
      item: "space",
      trailing: many,
      imaginary: true,
      layout: { between: "line" },
    }),
  );

const typeList =(children: Parameters<typeof sepBy>[1]) =>
  grpAngle(sepBy(",", children, { trailing: when("manyItems"), imaginary: true }));

// ktfmt puts a blank line before every declaration of a file or class body but between two properties (or two file
// annotations), where it keeps the source's.
const blank = not(
  any(
    all(kindIs("property_declaration"), prevItem(kindIs("property_declaration"))),
    all(kindIs("file_annotation"), prevItem(kindIs("file_annotation"))),
  ),
);

// The modifiers other than annotations, which never break apart.
const keywordModifiers = [
  "visibility_modifier",
  "function_modifier",
  "class_modifier",
  "member_modifier",
  "inheritance_modifier",
  "property_modifier",
  "platform_modifier",
  "parameter_modifier",
] as const;

/** A declaration: one group, which its annotations' lines break with (see `modifiers`). */
const decl = <T>(body: T) => group(body);

// The grammar makes a property's accessors and explicit backing field its siblings; they continue it.
const follow = any(kindIs("getter", "setter"), when("backingField"));

const ctorLine = either(when("commentedConstructor"), [], line);

export const kotlin = format({
  structure: {
    source_file: ($) => lines($.children, { blank, follow, imports: { kind: "import_list", via: "imports" } }),
    package_header: () => inOrder(space),
    import_list: ($) => lines($.children),
    import_header: () => spaced(),
    import_alias: () => inOrder(space),
    identifier: () => inOrder(),
    file_annotation: () => inOrder(),
    // Inside the hanging group a lambda's `{` (or `->`) opens, so the break it forces reaches that group too.
    // `@Suppress("X") b = f()` keeps its annotation, which the grammar makes a statement of its own, on the line.
    statements: ($) => [
      either(when("lambdaWrittenBroken"), breakParent, []),
      either(when("blankAfterBrace"), hardline, []),
      lines($.children, { tokens: true, sameLine: when("annotatedOnItsLine") }),
    ],

    // A declaration's annotations each go on a line of their own once the declaration (the `group` `decl` puts
    // it in) breaks, a block body's included; the keyword modifiers after them stay on one line.
    modifiers: () => [
      either(when("annotationsBreak"), breakParent, []),
      inOrder({ join: "line", spaceWhen: { after: keywordModifiers } }),
      either(lastItem(kindIs("annotation")), line, space),
    ],
    // `@field:[Inject Named("x")]`: the annotations a bracket groups are spaced apart.
    annotation: () => inOrder({ join: "space", tight: { after: ["@", "[", "use_site_target"], before: ["]"] } }),
    use_site_target: () => inOrder(),

    // A line comment after the primary constructor puts the body's `{` on a line of its own.
    class_declaration: () =>
      either(
        when("commentedConstructor"),
        either(
          when("commentedBody"),
          decl(
            inOrder({
              join: "space",
              hardWhen: { before: ["primary_constructor", "class_body"] },
              tight: { before: [...before, "type_parameters"] as never[], after: [...after, "modifiers"] as never[] },
            }),
          ),
          decl(
            inOrder({
              join: "space",
              hardWhen: { before: ["primary_constructor"] },
              tight: { before: [...before, "type_parameters"] as never[], after: [...after, "modifiers"] as never[] },
            }),
          ),
        ),
        either(
          when("commentedBody"),
          decl(
            inOrder({
              join: "space",
              hardWhen: { before: ["class_body"] },
              tight: {
                before: [...before, "type_parameters", "primary_constructor"] as never[],
                after: [...after, "modifiers"] as never[],
              },
            }),
          ),
          either(
            when("whereAfterDelegation"),
            decl(
              inOrder({
                join: "space",
                tight: {
                  before: [...before, "type_parameters", "primary_constructor"] as never[],
                  after: [...after, "modifiers"] as never[],
                },
                lineBefore: ["type_constraints"],
              }),
            ),
            decl(spaced({ tightBefore: ["type_parameters", "primary_constructor"] })),
          ),
        ),
      ),
    object_declaration: () => decl(spaced()),
    object_literal: () => spaced(),
    companion_object: () => decl(spaced()),
    // ktfmt keeps a blank line the source has after the `{`, as it does in a block (`statements`).
    class_body: ($) =>
      either(
        isEmpty,
        ["{", "}"],
        [
          "{",
          indent([hardline, either(when("blankAfterBrace"), hardline, []), lines($.children, { blank, follow })]),
          hardline,
          "}",
        ],
      ),
    enum_class_body: () => custom("enumBody"),
    enum_entry: () => decl(spaced()),
    // `class Foo @Inject constructor(...)`: once the header overflows, `constructor` and its modifiers go on a line
    // of their own at the class's indent, each annotation on its own line; the parameters then break only if they
    // still overflow. A comment before it puts it on a line of its own (see `class_declaration`).
    primary_constructor: ($) =>
      either(
        has("children", "modifiers"),
        group([
          ctorLine,
          $.children.at(0).andThen((m) => m),
          "constructor",
          grpParen(sepBy(",", $.children.from(1), { trailing: when("manyItems"), imaginary: true })),
        ]),
        either(
          firstText({ is: ["constructor"] }),
          group([ctorLine, "constructor", grpParen(sepBy(",", $.children, { trailing: when("manyItems"), imaginary: true }))]),
          grpParen(sepBy(",", $.children, { trailing: when("manyItems"), imaginary: true })),
        ),
      ),
    class_parameter: () => decl(spaced({ tightBefore: [":"] })),
    delegation_specifier: () => spaced(),
    explicit_delegation: () => spaced(),
    constructor_invocation: () => inOrder(),
    secondary_constructor: () => decl(spaced({ braces: true })),
    anonymous_initializer: () => decl(spaced({ braces: true })),
    constructor_delegation_call: () => inOrder(),
    type_alias: () => decl(spaced({ tightBefore: ["type_parameters"] })),

    function_declaration: () => decl(spaced({ tightBefore: [":"] })),
    // A parameter's modifiers and default are its siblings, so an entry is the run between two commas. With no
    // parameter, a list prints the comments between the parentheses.
    function_value_parameters: ($) =>
      either(
        has("children", "parameter"),
        either(when("manyItems"), parameterList(true), parameterList(false)),
        grpParen(sepBy(",", $.children)),
      ),
    parameter: () => spaced({ tightBefore: [":"] }),
    // A setter's `set(value)` parameter, whose type may be left out.
    parameter_with_optional_type: () => spaced({ tightBefore: [":"] }),
    parameter_modifiers: () => inOrder(space),
    parameter_modifier: () => inOrder(),
    function_body: () => spaced({ braces: true, hang: true, hug: "huggedChain" }),
    anonymous_function: () => spaced({ tightBefore: [":"] }),
    // A property breaks after its type's `:` as ktfmt does (property.ts).
    property_declaration: () => custom("property"),
    // `by lazy { }`: the delegate hangs off `by` as an initializer hangs off `=`.
    property_delegate: () => inOrder({ join: "space", hangAfter: ["by"], hug: when("huggedChain") }),
    variable_declaration: () => custom("typedName"),
    // ktfmt keeps a written trailing comma in a destructuring or an index, and breaks the list around it.
    multi_variable_declaration: ($) =>
      either(when("commaWritten"), grpParen(sepBy(",", $.children, { trailing: true })), adjacent),
    getter: () => decl(spaced({ tightBefore: [":", "("] })),
    // ktfmt drops a trailing comma after the parameter, as it does after a `catch`'s.
    setter: () => decl(spaced({ tightBefore: [":", "("], skip: [","] })),

    user_type: () => inOrder(),
    // The grammar hides the `?`, so no rule could print it: the type prints as written.
    nullable_type: () => verbatim,
    // `T & Any`, and an intersection ktfmt parses, `A & B & C`.
    not_nullable_type: () => inOrder(space),
    // One the source keeps on one line prints in fmt.ts.
    type_arguments: ($) => typeList($.children),
    type_parameters: ($) => typeList($.children),
    type_parameter: () => inOrder(space),
    type_constraints: () => spaced(),
    type_constraint: () => spaced(),
    type_projection: () => inOrder(space),
    function_type: () => spaced(),
    function_type_parameters: () => inOrder({ spaceWhen: { after: [",", "type_modifiers"] } }),
    parenthesized_type: () => inOrder({ spaceWhen: { after: ["type_modifiers"] } }),
    type_modifiers: () => inOrder(space),

    // ktfmt keeps a lambda or scoping function on the `=`'s line, but hangs a chain on one.
    // An explicit backing field the grammar reads as an assignment to `field` hugs as a property's initializer does.
    assignment: () =>
      either(when("backingField"), spaced({ hang: true, hug: "huggedChain" }), spaced({ hang: true, hug: "hugged" })),
    directly_assignable_expression: () => inOrder(),
    call_expression: () => inOrder(),
    // A trailing lambda alone (`forEach { }`) is spaced off its callee, which prints before this node.
    call_suffix: () =>
      either(
        not(any(has("children", "value_arguments"), has("children", "type_arguments"))),
        [space, inOrder()],
        inOrder({ spaceWhen: { before: ["annotated_lambda"] } }),
      ),
    // ktfmt hugs a sole unnamed lambda argument to the parentheses (`doIt({`), which then break inside the lambda,
    // and drops its trailing comma.
    value_arguments: ($) =>
      either(
        when("soleLambda"),
        inOrder({ skip: [","] }),
        grpParen(sepBy(",", $.children, { trailing: when("manyItems"), imaginary: true })),
      ),
    // A named argument's value hangs off its `=` once it does not fit on that line, but a lambda stays there.
    value_argument: () =>
      either(
        has("children", "lambda_literal"),
        inOrder({ join: "space", tight: { after: ["*"] } }),
        inOrder({ join: "space", tight: { after: ["*"] }, hangAfter: ["="] }),
      ),
    annotated_lambda: () => inOrder({ join: "space", tight: { after: ["label"] } }),
    // One with no statements prints in lambda.ts.
    lambda_literal: () => group(inOrder({ join: "line", hangAfter: ["{", "->"], spaceWhen: { before: ["->"] } })),
    // Prints in lambda.ts.
    lambda_parameters: () => adjacent,
    // A member chain prints from its root in chain.ts.
    navigation_expression: () => inOrder(),
    navigation_suffix: () => inOrder(),
    indexing_expression: () => inOrder(),
    indexing_suffix: ($) =>
      either(when("commaWritten"), grpBracket(sepBy(",", $.children, { trailing: true })), adjacent),
    // `[a, b]`, in an annotation's arguments. As a named argument's value it hangs off the `=` (`value_argument`).
    collection_literal: ($) => grpBracket(sepBy(",", $.children, { trailing: when("manyItems") })),
    parenthesized_expression: () => inOrder(),
    spread_expression: () => inOrder(),
    // An annotated expression (`@Suppress("X") f()`) keeps the gap the source has after the annotation: where it
    // has none, the grammar took an annotation's arguments (`@Suppress("X")` above a declaration it misparses) for
    // the expression, and a space would change what the code means. Where the annotation covers the whole
    // expression, not just a binary one's first operand, ktfmt breaks the line after it once the expression
    // does not fit on it (`annotationHangs`), and always before a `return` (`annotationLineBroken`).
    prefix_expression: () =>
      either(
        when("annotationHangs"),
        group(inOrder({ join: "line" })),
        either(
          when("operatorFuses"),
          inOrder(space),
          inOrder({
            join: "gap",
            hardWhen: { when: when("annotationLineBroken") },
            tight: { after: ["!", "-", "+", "++", "--"] },
          }),
        ),
      ),
    postfix_expression: () => inOrder(),
    this_expression: () => inOrder(),
    super_expression: () => inOrder(),
    callable_reference: () => inOrder(),
    jump_expression: () => inOrder({ join: "space", tight: { after: ["return@", "break@", "continue@"] } }),
    additive_expression: binary,
    multiplicative_expression: binary,
    comparison_expression: binary,
    equality_expression: binary,
    conjunction_expression: binary,
    disjunction_expression: binary,
    elvis_expression: binary,
    infix_expression: binary,
    // `a as T`, `a is T`: ktfmt's block of the operand, the operator and the type, broken before and after the
    // operator together, indented, once it overflows or the type breaks (`in` prints in binary.ts).
    as_expression: () => group(indent(inOrder({ join: "line" }))),
    check_expression: () => group(indent(inOrder({ join: "line" }))),
    range_expression: () => inOrder(),
    type_test: () => inOrder(space),
    range_test: () => inOrder(space),

    if_expression: () => spaced(),
    control_structure_body: () => inOrder({ braces: true }),
    when_expression: () => spaced({ braces: true }),
    when_subject: () => spaced(),
    // ktfmt puts each condition on a line of its own, and hangs the body off `->` but for a block or a lambda.
    when_entry: () =>
      inOrder({
        join: "space",
        tight: { before: [","] },
        hardWhen: { after: [","] },
        hangAfter: ["->"],
        hug: firstText({ prefix: ["{"] }),
      }),
    when_condition: () => inOrder(space),
    when_guard: () => inOrder(space),
    for_statement: () => spaced(),
    while_statement: () => spaced(),
    do_while_statement: () => spaced(),

    // A multiline string breaks the group it sits in, so it starts a line of its own after `=`.
    string_literal: () => either(spansLines, [breakParent, text("trimEnd")], text("trimEnd")),
    character_literal: () => verbatim,
    unsigned_literal: () => verbatim,
    long_literal: () => verbatim,
    type_projection_modifiers: () => inOrder(space),
    type_parameter_modifiers: () => inOrder(space),
    try_expression: () => spaced({ braces: true }),
    catch_block: () => spaced({ braces: true, tightBefore: [":"], skip: [","] }),
    finally_block: () => spaced({ braces: true }),
  },
  wrapping: {
    source_file: { blankLines: "force" },
    class_body: { blankLines: "force" },
    statements: { blankLines: "force" },
    when_expression: { blankLines: "force" },
    value_arguments: { breakWhen: when("writtenBroken") },
    function_value_parameters: { breakWhen: when("writtenBroken") },
    collection_literal: { breakWhen: when("writtenBroken") },
    type_arguments: { breakWhen: when("writtenBroken") },
    type_parameters: { breakWhen: when("writtenBroken") },
    primary_constructor: { breakWhen: when("writtenBroken") },
    multi_variable_declaration: { breakWhen: when("commaWritten") },
    indexing_suffix: { breakWhen: when("commaWritten") },
  },
  unknown: "bail",
  docComment: kdoc,
});
