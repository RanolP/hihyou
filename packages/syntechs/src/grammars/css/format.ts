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
const combinator = () => inOrder({ join: "line", spaceWhen: { after: [">", ">>>", "~", "+", "<"] } });
/** Selectors one per line, one of more than two parts indenting as it breaks; then each `trail` child after a space. */
const selectorList = (trail: "block"[] = []) =>
  splitOn(",", { trail, wrapItem: when("longSelector"), layout: { group: true, between: "hardline" } });
/** The statement's own `;`, or one prettier adds. */
const semicolon = tok(";").synth(true);
/** `layout` for two entries or more; a lone entry prints bare. */
const loneBare = <L>(layout: L) => ({ when: entryCount(1), then: {}, else: layout });
type Cond = CondIn<typeof grammar, CssOptions>;
/** A function call's name is `name`, in any case. */
const calledAs = (name: string) => firstText({ is: [name], anyCase: true });
/**
 * A declaration's comma list: a lone entry bare; one entry per line once an entry has several words (prettier's
 * `shouldBreakList`, and a lone math expression, which oxc-css-parser reads as several values), but in a custom
 * property; else packed after an optional break past the colon.
 */
const valueLayout: SplitLayoutOf<Cond> = loneBare({
  when: all(
    not(firstText({ prefix: ["--"] })),
    any(anyEntry({ many: true, startsWith: ["+", "-"] }), when("mathEntry")),
  ),
  then: { indent: true, first: "hard", between: "hardline" },
  else: { group: true, indent: true, first: "soft", between: "line", fill: true },
});
/** An at-rule whose prelude prettier parses as a value. */
const directive = firstText({ is: directives });
/**
 * Inside a media query's top-level `( … )`: prettier's media-feature-expression, whose text before any `:` it prints
 * as written with each run of spaces as one, so `(not (  a  ))` keeps its inner gaps as `(not ( a ))`.
 */
const inMediaFeature = all(
  ancestor("parenthesized_query"),
  ancestor(["media_statement", "custom_media_statement"], { stop: ["block"] }),
);
const asWritten = () => inOrder({ join: "gap" });
/** Inside a `directive`'s prelude. */
const inDirective = ancestor(["at_rule", "postcss_statement"], { stop: ["block"], holds: directive });
/** Statements one per line, keeping one blank line where the source has any. */
const statements = { blankLines: "force" } as const;

/** CSS as prettier 3.9.9's postcss printer lays it out. */
export const css = format({
  structure: {
    stylesheet: ($) => lines($.children),
    block: ($) => grpBrace(lines($.children)),
    keyframe_block_list: ($) => grpBrace(lines($.children)),
    // Its children spaced, but a selector holding a comment as written (fmt.ts's `ruleSet`).
    rule_set: () => custom("ruleSet"),
    // After `@nest` and `@extend`, the selectors share a line, indented once they break after `@extend` only.
    selectors: () =>
      either(
        parentIs("nest_statement"),
        splitOn(",", { wrapItem: when("longSelector"), layout: { group: true, between: "line" } }),
        either(
          parentIs("extend_statement"),
          splitOn(",", { wrapItem: when("longSelector"), layout: { group: true, indent: true, between: "line" } }),
          selectorList(),
        ),
      ),
    keyframe_block: () => selectorList(["block"]),
    from: () => text("lower"),
    to: () => text("lower"),

    // A value postcss-value-parser fails on, or oxfmt keeps raw (fmt.ts's `unparsedValue`), as written; an IE
    // filter's (`progid:...`) value, one space wherever the source has any gap (prettier's raw value); a normal
    // property's value oxc-css-parser reads as raw tokens, as fmt.ts's `colonThenRawTokens` lays them out; else the comma
    // list, a grid template's keeping its lines, and an empty value's gap as written (fmt.ts's `declarationEnd`). The
    // comments around the `:` print as postcss's `between` (fmt.ts's `declarationColon`).
    declaration: ($) => [
      either(
        when("unparsedValue"),
        [$.children.at(0).andThen((p) => p), tok(":").via("colonThenSource")],
        either(
          firstText({ after: ":", prefix: ["progid:"] }),
          inOrder({
            join: "gap",
            tight: { before: [":"] },
            spaceWhen: { after: [":"], before: ["important"] },
            verbatim: { except: ["property_name", "important"] },
            skip: [";"],
          }),
          either(
            when("rawTokens"),
            [$.children.at(0).andThen((p) => p), tok(":").via("colonThenRawTokens")],
          [
            $.children.at(0).andThen((p) => p),
            tok(":").via("declarationColon"),
            either(when("emptyValue"), [], space),
            // A CSS Modules `composes` value prints with its lines removed (prettier's css-decl), its words on one line.
            either(
              firstText({ is: ["composes"], anyCase: true }),
              splitOn(",", {
                except: ["property_name", ":", ";"],
                trail: ["important", "ERROR"],
                comments: true,
                item: "space",
                layout: { group: true, between: "line" },
              }),
              splitOn(",", {
                except: ["property_name", ":", ";"],
                trail: ["important", "ERROR"],
                comments: true,
                item: words({
                  keepLines: all(entryCount(1), firstText({ is: ["grid"], prefix: ["grid-template"], anyCase: true })),
                  apart: when("ownWord"),
                }),
                layout: valueLayout,
              }),
            ),
          ],
          ),
        ),
      ),
      tok(";").via("declarationEnd"),
    ],
    // `--name: {...}`: the block laid out as a rule's, then the `;` a declaration ends with; the comments around the
    // `:` as a declaration's (fmt.ts's `declarationColon`).
    custom_property_set: ($) => [
      $.children.at(0).andThen((p) => p),
      tok(":").via("declarationColon"),
      space,
      $.children.at(1).andThen((b) => b),
      semicolon,
    ],
    // postcss-nested-props: a rule whose selector is `name:` and any values, as written.
    nested_property: () =>
      inOrder({ join: "gap", tight: { before: [":"] }, spaceWhen: { after: [":"], before: ["block"] } }),
    property_name: () => text("maybeLower"),
    important: () => custom("important"),
    // Its unit's case normalized; after a function, a `+` sign spaced as an operator (fmt.ts's `number`).
    integer_value: () => custom("number"),
    float_value: () => custom("number"),
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
    // In a `directive`'s prelude, a Sass argument list as fmt.ts's `sassList` lays it out, but `url()`'s.
    call_expression: ($) =>
      either(
        all(inDirective, not(calledAs("url"))),
        [$.children.at(0).andThen((n) => n), $.children.at(1).andThen((n) => n.via("sassList"))],
        adjacent(),
      ),
    // A function's as written inside `url()`, a space wherever the source has a gap (postcss-value-parser's one
    // word, trimmed); else broken inside the parentheses: a function's as words, a pseudo-class's as selectors.
    arguments: () =>
      either(
        all(parentIs("call_expression"), ancestor("call_expression", { holds: calledAs("url") })),
        inOrder({ join: "gap", tight: { after: ["("], before: [")"] } }),
        either(
          parentIs("call_expression"),
          grpParen(
            splitOn(",", {
              except: ["(", ")"],
              comments: "all",
              item: words({ apart: when("ownWord") }),
              layout: { between: "line" },
            }),
          ),
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
    // `-(-1)`, `hue(* 20)`: fmt.ts's `unaryExpression`.
    unary_expression: () => custom("unaryExpression"),
    // A `{...}` group in a custom property's value or a Sass argument, as prettier prints a JSON-like one:
    // `{"a": 1, "b": 2}`.
    brace_value: () => inOrder({ tight: { after: ["{"], before: ["}", ","] }, spaceWhen: { after: [","] } }),
    // `[a b]`, `[1, "2"]`: tight inside the brackets, a space after each comma and wherever the source has a gap.
    grid_value: () =>
      inOrder({ join: "gap", tight: { after: ["["], before: ["]", ","] }, spaceWhen: { after: [","] } }),
    // `#ABCDEFG`, `#Abc-x`: a `#` word that is no color, as written.
    hash_value: () => text("trimEnd"),
    // A Sass list or map (fmt.ts's `sassList`) in a `directive`'s prelude or a `$variable`'s value, else on one line.
    parenthesized_value: () => custom("parenthesizedValue"),
    // Sass's `name: value` (fmt.ts's `keywordArgument`); `$args...` joined.
    keyword_argument: () => custom("keywordArgument"),
    rest_argument: adjacent,

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
    // A prelude holding a comment as postcss-media-query-parser splits its source (fmt.ts's `mediaQueries`).
    media_statement: () => [
      either(when("mediaComments"), tok("@media").via("mediaQueries"), [
        spell("@media", "atName"),
        space,
        splitOn(",", { except: ["@media"], trail: ["block"], layout: { group: true, indent: true, between: "line" } }),
      ]),
    ],
    // The prelude as prettier's value (fmt.ts's `supportsValue`).
    supports_statement: () => [tok("@supports").via("supportsValue")],
    import_statement: () => custom("importStatement"),
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
    // The name, then the queries as `@media`'s, spaced from the name even where the source has no gap.
    custom_media_statement: () =>
      inOrder({
        join: "gap",
        tight: { before: [",", ";"] },
        spaceWhen: { after: ["@custom-media", ",", "custom_media_name"] },
      }),
    keyframes_statement: spaced,
    // `@at-root`'s selectors are a rule's, or its `(with: ...)` query; `@nest`'s and `@extend`'s see `selectors`.
    at_root_statement: spaced,
    nest_statement: spaced,
    extend_statement: () => [inOrder({ join: "space", skip: [";"] }), semicolon],
    // A `directive`'s prelude as a value (fmt.ts's `sassDirective`), else prettier's raw params: as written, one
    // space wherever the source has any gap.
    at_rule: () => custom("atRule"),
    postcss_statement: () => custom("postcssStatement"),
    binary_query: () => either(inMediaFeature, asWritten(), inOrder(space)),
    unary_query: () => either(inMediaFeature, asWritten(), inOrder(space)),
    // The gaps inside a media feature's inner parentheses are trimmed: `(not ( a ))` prints `(not (a))`.
    parenthesized_query: () =>
      either(inMediaFeature, inOrder({ join: "gap", tight: { after: ["("], before: [")"] } }), inOrder()),
    feature_query: () =>
      inOrder({ join: "gap", tight: { after: ["("], before: [")", ":"] }, spaceWhen: { after: [":"] } }),
    // A media feature, spaced.
    range_query: () => inOrder({ join: "space", tight: { after: ["("], before: [")"] } }),
    feature_name: () => text("maybeLower"),
    // `selector(...)`: a selector list as a rule's, one per line inside the broken parentheses once it has two.
    selector_query: () => [
      "selector",
      grpParen(
        splitOn(",", {
          except: ["selector", "(", ")"],
          wrapItem: when("longSelector"),
          layout: { between: "hardline" },
        }),
      ),
    ],
  },
  wrapping: {
    stylesheet: statements,
    block: { ...statements, expand: "always" },
    keyframe_block_list: { ...statements, expand: "always" },
  },
});
