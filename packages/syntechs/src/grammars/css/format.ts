// CSS's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts. No kind of
// tree-sitter-css has fields, so a kind is laid out by its children in order (`inOrder`), a list of them, or, where
// prettier's postcss printer decides by more than the structure, a `custom` rule of fmt.ts.
import {
  custom,
  defineFormat,
  grpBrace,
  inOrder,
  lines,
  parentIs,
  space,
  splitOn,
  text,
  when,
} from "../../fmt/dsl/dsl.js";
import type { grammar } from "./bundle.js";
import type { CssOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, CssOptions>();

const spaced = () => inOrder(space);
const adjacent = () => inOrder();
/** Selectors on either side of a combinator: a line between, and after the combinator's token a space. */
const combinator = () => inOrder({ join: "line", spaceWhen: { after: [">", "~", "+"] } });
/** Selectors one per line, one of more than two parts indenting as it breaks; then each `trail` child after a space. */
const selectorList = (trail: "block"[] = []) =>
  splitOn(",", { trail, wrapItem: when("longSelector"), layout: { group: true, between: "hardline" } });
/** Statements one per line, keeping one blank line where the source has any. */
const statements = { blankLines: "force" } as const;

/** CSS as prettier 3.9.9's postcss printer lays it out. */
export const css = format({
  structure: {
    stylesheet: ($) => lines($.children),
    block: ($) => grpBrace(lines($.children)),
    keyframe_block_list: ($) => grpBrace(lines($.children)),
    rule_set: spaced,
    selectors: () => selectorList(),
    keyframe_block: () => selectorList(["block"]),
    from: () => text("lower"),
    to: () => text("lower"),

    declaration: () => custom("declaration"),
    property_name: () => text("maybeLower"),
    integer_value: () => text("unitCase"),
    float_value: () => text("unitCase"),
    color_value: () => text("lower"),
    string_value: () => text("requote"),
    plain_value: () => custom("plainValue"),
    call_expression: adjacent,
    arguments: () => custom("arguments"),
    // Spaced around the operator as written, and always inside `calc()`.
    binary_expression: () => inOrder({ join: "gap", spaceWhen: { when: when("inCalc") } }),
    parenthesized_value: adjacent,

    class_selector: adjacent,
    id_selector: adjacent,
    pseudo_element_selector: adjacent,
    pseudo_class_selector: adjacent,
    namespace_selector: adjacent,
    attribute_selector: adjacent,
    child_selector: combinator,
    descendant_selector: combinator,
    sibling_selector: combinator,
    adjacent_sibling_selector: combinator,
    class_name: () => text("lower", parentIs("pseudo_class_selector")),
    tag_name: () => text("lower", parentIs("pseudo_element_selector")),

    at_keyword: () => text("atName"),
    media_statement: () => custom("media"),
    supports_statement: spaced,
    import_statement: () => custom("import"),
    namespace_statement: () => inOrder({ join: "space", tight: { before: [";"] } }),
    // Prettier's raw at-rule parameters: as written, one space wherever the source has any gap.
    charset_statement: () =>
      inOrder({
        join: "gap",
        tight: { before: [";"] },
        spaceWhen: { after: ["@charset"] },
        verbatim: true,
      }),
    keyframes_statement: spaced,
    at_rule: () =>
      inOrder({
        join: "gap",
        tight: { before: [";"] },
        spaceWhen: { after: ["at_keyword"], before: ["block"] },
        verbatim: { except: ["at_keyword", "block"] },
      }),
    binary_query: spaced,
    unary_query: spaced,
    parenthesized_query: adjacent,
    feature_query: () =>
      inOrder({ join: "gap", tight: { after: ["("], before: [")"] }, spaceWhen: { after: [":"] } }),
    feature_name: () => text("maybeLower"),
  },
  wrapping: {
    stylesheet: statements,
    block: { ...statements, expand: "always" },
    keyframe_block_list: { ...statements, expand: "always" },
  },
});
