// CSS's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts. No kind of
// tree-sitter-css has fields, so a kind is laid out by its children in order (`inOrder`), a list of them, or, where
// prettier's postcss printer decides by more than the structure, a `custom` rule of fmt.ts.
import {
  all,
  anyEntry,
  type CondIn,
  custom,
  defineFormat,
  either,
  entryCount,
  firstText,
  grpBrace,
  grpParen,
  inOrder,
  lines,
  not,
  parentIs,
  space,
  spell,
  type SplitLayoutOf,
  splitOn,
  text,
  tok,
  when,
  words,
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
/** The statement's own `;`, or one prettier adds. */
const semicolon = tok(";").synth(true);
/** Comma-separated values packed several to a line, indented once they break. */
const packed = { group: true, indent: true, between: "line", fill: true } as const;
/** `layout` for two entries or more; a lone entry prints bare. */
const loneBare = <L>(layout: L) => ({ when: entryCount(1), then: {}, else: layout });
type Cond = CondIn<typeof grammar, CssOptions>;
/**
 * A declaration's comma list: a lone entry bare; one entry per line once an entry has several words (prettier's
 * `shouldBreakList`), but in a custom property; else packed after an optional break past the colon.
 */
const valueLayout: SplitLayoutOf<Cond> = loneBare({
  when: all(not(firstText({ prefix: ["--"] })), anyEntry({ many: true, startsWith: ["+", "-"] })),
  then: { indent: true, first: "hard", between: "hardline" },
  else: { group: true, indent: true, first: "soft", between: "line", fill: true },
});
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

    // An IE filter's (`progid:...`) value as written, one space wherever the source has any gap (prettier's raw
    // value); else the comma list, a grid template's keeping its lines.
    declaration: ($) => [
      either(
        firstText({ after: ":", prefix: ["progid:"] }),
        inOrder({
          join: "gap",
          tight: { before: [":"] },
          spaceWhen: { after: [":"], before: ["important"] },
          verbatim: { except: ["property_name", "important"] },
          skip: [";"],
        }),
        [
          $.children.at(0).andThen((p) => p),
          ":",
          space,
          splitOn(",", {
            except: ["property_name", ":", ";"],
            trail: ["important"],
            item: words({
              keepLines: all(entryCount(1), firstText({ is: ["grid"], prefix: ["grid-template"], anyCase: true })),
            }),
            layout: valueLayout,
          }),
        ],
      ),
      semicolon,
    ],
    property_name: () => text("maybeLower"),
    integer_value: () => text("unitCase"),
    float_value: () => text("unitCase"),
    color_value: () => text("lower"),
    string_value: () => text("requote"),
    plain_value: () => custom("plainValue"),
    call_expression: adjacent,
    // A function's as written inside `url()`, else broken inside the parentheses: a function's as words, a
    // pseudo-class's as selectors.
    arguments: () =>
      either(
        when("urlArguments"),
        adjacent(),
        either(
          parentIs("call_expression"),
          grpParen(splitOn(",", { except: ["(", ")"], item: words(), layout: { between: "line" } })),
          grpParen(
            splitOn(",", {
              except: ["(", ")"],
              item: "space",
              wrapItem: when("longSelector"),
              layout: { between: "line" },
            }),
          ),
        ),
      ),
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
    media_statement: () => [
      spell("@media", "atName"),
      space,
      splitOn(",", { except: ["@media"], trail: ["block"], layout: { group: true, indent: true, between: "line" } }),
    ],
    supports_statement: spaced,
    import_statement: () => [
      spell("@import", "atName"),
      space,
      splitOn(",", { except: ["@import", ";"], item: words(), layout: loneBare(packed) }),
      semicolon,
    ],
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
