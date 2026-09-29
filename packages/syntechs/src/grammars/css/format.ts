// CSS's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts. No kind of
// tree-sitter-css has fields, so a kind is laid out by its children in order (`inOrder`), a list of them, or, where
// prettier's postcss printer decides by more than the structure, a `custom` rule of fmt.ts.
import {
  all,
  ancestor,
  any,
  anyEntry,
  type CondIn,
  custom,
  defineFormat,
  either,
  entryCount,
  firstText,
  grpBrace,
  grpParen,
  has,
  inOrder,
  isEmpty,
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
import { directives } from "./directive.js";
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
/** A function call's name is `name`, in any case. */
const calledAs = (name: string) => firstText({ is: [name], anyCase: true });
/**
 * A declaration's comma list: a lone entry bare; one entry per line once an entry has several words (prettier's
 * `shouldBreakList`), but in a custom property; else packed after an optional break past the colon.
 */
const valueLayout: SplitLayoutOf<Cond> = loneBare({
  when: all(not(firstText({ prefix: ["--"] })), anyEntry({ many: true, startsWith: ["+", "-"] })),
  then: { indent: true, first: "hard", between: "hardline" },
  else: { group: true, indent: true, first: "soft", between: "line", fill: true },
});
/** An at-rule whose prelude prettier parses as a value. */
const directive = firstText({ is: directives });
/** Inside a `directive`'s prelude. */
const inDirective = ancestor(["at_rule", "postcss_statement"], { stop: ["block"], holds: directive });
/**
 * A `directive`'s prelude as a value: its comma list packed and indented once it breaks, each entry's words filled
 * in a group of its own.
 */
const directivePrelude = (trail: "block"[]) =>
  splitOn(",", { except: ["at_keyword", ";"], trail, item: words(), layout: loneBare(packed) });
/** Statements one per line, keeping one blank line where the source has any. */
const statements = { blankLines: "force" } as const;

/** CSS as prettier 3.9.9's postcss printer lays it out. */
export const css = format({
  structure: {
    stylesheet: ($) => lines($.children),
    block: ($) => grpBrace(lines($.children)),
    keyframe_block_list: ($) => grpBrace(lines($.children)),
    rule_set: spaced,
    // After `@nest` and `@extend`, prettier's selectors share a line, indented once they break.
    selectors: () =>
      either(
        any(parentIs("nest_statement"), parentIs("extend_statement")),
        splitOn(",", { wrapItem: when("longSelector"), layout: { group: true, indent: true, between: "line" } }),
        selectorList(),
      ),
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
    // `--name: {...}`: the block laid out as a rule's, then the `;` a declaration ends with.
    custom_property_set: () => [inOrder({ spaceWhen: { after: [":"] }, skip: [";"] }), semicolon],
    // postcss-nested-props: a rule whose selector is `name:` and any values, as written.
    nested_property: () =>
      inOrder({ join: "gap", tight: { before: [":"] }, spaceWhen: { after: [":"], before: ["block"] } }),
    property_name: () => text("maybeLower"),
    integer_value: () => text("unitCase"),
    float_value: () => text("unitCase"),
    color_value: () => text("lower"),
    string_value: () => text("requote"),
    // Quoted inside `[attr=value]`, an `an+b` spaced around its `+`, else a CSS-wide keyword lowercased.
    plain_value: () =>
      either(
        parentIs("attribute_selector"),
        text("quote"),
        either(
          all(
            parentIs("arguments"),
            ancestor("pseudo_class_selector", {
              stop: ["call_expression"],
              holds: firstText({ after: ":", prefix: ["nth-"], anyCase: true }),
            }),
          ),
          text("spacePlus"),
          text("cssWide"),
        ),
      ),
    call_expression: adjacent,
    // A function's as written inside `url()`, else broken inside the parentheses: a function's as words, a
    // pseudo-class's as selectors.
    arguments: () =>
      either(
        all(parentIs("call_expression"), ancestor("call_expression", { holds: calledAs("url") })),
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
    // Prettier's math in a value, which fmt.ts's `valueMath` lays out as its operands and operators in a row.
    binary_expression: () => custom("valueMath"),
    // Broken inside the parentheses in a `directive`'s prelude, as prettier's paren group.
    parenthesized_value: () => either(inDirective, grpParen(splitOn(",", { except: ["(", ")"] })), adjacent()),

    class_selector: adjacent,
    id_selector: adjacent,
    placeholder_selector: adjacent,
    pseudo_element_selector: adjacent,
    pseudo_class_selector: adjacent,
    namespace_selector: adjacent,
    // `[name=value flag]`: tight but for the space before a case-sensitivity flag, and `ns|name` joined.
    attribute_selector: () => inOrder({ spaceWhen: { before: ["attribute_flag"] } }),
    // A plain name is one leaf, kept as written (`trimEnd` changes no identifier); `ns|name` is joined.
    attribute_name: () => either(isEmpty, text("trimEnd"), adjacent()),
    child_selector: combinator,
    descendant_selector: combinator,
    sibling_selector: combinator,
    adjacent_sibling_selector: combinator,
    class_name: () => text("maybeLower", parentIs("pseudo_class_selector")),
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
    // The name, then the selectors on its line or, past the width, one per line under it.
    custom_selector_statement: ($) => [
      "@custom-selector",
      space,
      $.children.at(0).andThen((n) => n),
      splitOn(",", {
        except: ["@custom-selector", "custom_selector_name", ";"],
        wrapItem: when("longSelector"),
        layout: { group: true, indent: true, first: "line", between: "line" },
      }),
      semicolon,
    ],
    // The name, then the queries as `@media`'s; the name and a query written without a gap between stay joined.
    custom_media_statement: () =>
      inOrder({
        join: "gap",
        tight: { before: [",", ";"] },
        spaceWhen: { after: ["@custom-media", ","] },
      }),
    keyframes_statement: spaced,
    // `@at-root`'s selectors are a rule's, or its `(with: ...)` query; `@nest`'s and `@extend`'s see `selectors`.
    at_root_statement: spaced,
    nest_statement: spaced,
    extend_statement: () => [inOrder({ join: "space", skip: [";"] }), semicolon],
    at_rule: ($) =>
      either(
        directive,
        either(
          has("children", "block"),
          [$.children.at(0).andThen((n) => n), space, directivePrelude(["block"])],
          [$.children.at(0).andThen((n) => n), space, directivePrelude([]), semicolon],
        ),
        inOrder({
          join: "gap",
          tight: { before: [";"] },
          // `@page:first` stays joined: postcss reads a name up to the first gap.
          spaceWhen: { before: ["block"] },
          verbatim: { except: ["at_keyword", "block"] },
        }),
      ),
    postcss_statement: ($) =>
      either(
        directive,
        [$.children.at(0).andThen((n) => n), space, directivePrelude([]), semicolon],
        inOrder({ join: "gap", tight: { before: [";"] }, spaceWhen: { after: ["at_keyword"] }, verbatim: true }),
      ),
    binary_query: spaced,
    unary_query: spaced,
    parenthesized_query: adjacent,
    feature_query: () =>
      inOrder({ join: "gap", tight: { after: ["("], before: [")", ":"] }, spaceWhen: { after: [":"] } }),
    // prettier's media feature: as written, one space wherever the source has any gap.
    range_query: () => inOrder({ join: "gap", tight: { after: ["("], before: [")"] } }),
    feature_name: () => text("maybeLower"),
  },
  wrapping: {
    stylesheet: statements,
    block: { ...statements, expand: "always" },
    keyframe_block_list: { ...statements, expand: "always" },
  },
});
