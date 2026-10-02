// HTML's layout in the formatter DSL (src/fmt/dsl/dsl.ts); `pnpm generate` compiles it into fmt.gen.ts. The rules
// lay out prettier's HTML AST, which print.ts builds from tree-sitter-html's tree (ast.ts names its kinds), as
// prettier 3.9.9's printer-html.js and print/*.js do. What decides a layout and no structure says is print.ts's:
// whether a node is sensitive to the whitespace around it, which follows the CSS display of it and of its
// neighbours (`pred("spaces", ...)` and the `gap` between two children), and which tag markers a neighbour
// prints (`hook("prefix")`, `hook("suffix")` and `pred("lent", ...)`).
import {
  any,
  breakParent,
  custom,
  dedentToRoot,
  defineFormat,
  each,
  either,
  fill,
  flow,
  group,
  hardline,
  has,
  hook,
  ifBreak,
  ifFlat,
  indent,
  line,
  lit,
  literalline,
  option,
  pred,
  softline,
  space,
} from "../../fmt/dsl/dsl.js";
import type { grammar } from "./ast.js";
import type { HtmlOptions } from "./fmt.js";

const format = defineFormat<typeof grammar, HtmlOptions>();

type Children = Parameters<typeof each>[0];

/** print/children.js's printChildren; every gap breaks in an element prettier always breaks (forceBreakChildren). */
const children = (list: Children) =>
  flow(list, { gap: "gap", textLike: pred("textLike"), blank: pred("blankAfter"), breakAll: pred("forceBreakChildren") });

/** A tag's `<name` (or a conditional comment's `<!--[if ...`), with the text before it, unless the node before prints them. */
const openStart = either(pred("lent", "openStart"), [], [hook("prefix"), hook("marker", "openStart")]);
/** A tag's `>`, with the text after it, unless the node after prints them. */
const closeEnd = either(pred("lent", "closeEnd"), [], [hook("marker", "closeEnd"), hook("suffix")]);

/** print/tag.js's printAttributes: a line before each, the `>` on a line of its own when they break. */
const attributes = (attrs: Children) =>
  either(
    has("attrs"),
    [
      indent(each(attrs, { first: line, between: either(option("singleAttributePerLine"), hardline, line) })),
      either(
        any(pred("lent", "openEnd"), pred("lent", "selfCloseEnd"), option("bracketSameLine")),
        either(pred("selfClosing"), space, []),
        either(pred("selfClosing"), line, softline),
      ),
    ],
    either(pred("selfClosing"), space, []),
  );

/** print/tag.js's printOpeningTag. */
const openingTag = (attrs: Children) => [
  openStart,
  attributes(attrs),
  either(any(pred("selfClosing"), pred("lent", "openEnd")), [], hook("marker", "openEnd")),
];

/** print/tag.js's printClosingTag: the `</name` unless the last child prints it, and the `>`. */
const closingTag = [
  either(
    any(pred("selfClosing"), pred("lent", "closeStart")),
    [],
    [hook("marker", "lastChildCloseEnd"), hook("marker", "closeStart")],
  ),
  closeEnd,
];

/** A `"`-quoted value printed expanded (print/attribute/utils.js's printExpand). */
const expand = <T>(body: T) => [hook("text", "open"), group([indent([softline, body]), softline]), lit('"')];

export const html = format({
  structure: {
    // printer-html.js's root: the front matter, a blank line, and the content.
    root: ($) => [
      $.frontMatter.andThen((f) => [f, either(has("children"), [hardline, hardline], [])]),
      group(children($.children)),
    ],
    front_matter: ($) => each($.children, { between: hardline }),
    // A line keeps its trailing whitespace, which no text the DSL prints does.
    front_line: () => custom("frontMatterLine"),

    // print/element.js's printElement.
    element: ($) =>
      group([
        group(openingTag($.attrs)),
        either(
          has("children"),
          [
            either(pred("forceBreakContent"), breakParent, []),
            indent([
              either(
                pred("spaces", "leading", "first"),
                line,
                // A pre's first text keeps its line break as written, where an indentation would add to it.
                either(pred("preText"), dedentToRoot(softline), softline),
              ),
              children($.children),
            ]),
            // print/element.js's printLineAfterChildren.
            either(
              pred("lent", "closeEnd"),
              either(pred("spaces", "trailing", "last"), space, []),
              either(
                pred("preLastLendsCloseStart"),
                [],
                either(
                  pred("spaces", "trailing", "last"),
                  line,
                  either(pred("lastEndsAtIndent"), [], softline),
                ),
              ),
            ),
          ],
          either(pred("spaces", "dangling", "self"), line, []),
        ),
        closingTag,
      ]),
    // A script or style: its content on lines of its own, in its language.
    embedded_element: ($) =>
      group([group(openingTag($.attrs)), breakParent, indent([hardline, $.content]), hardline, closingTag]),
    // A pre-like element holding more than text keeps its content as written (shouldPreserveContent).
    preserved_element: ($) => [group(openingTag($.attrs)), hook("text", "value"), closingTag],
    raw_text: ($) => each($.children, { between: hardline }),
    raw_line: () => hook("text", "value"),
    // Another language's tree, which its own formatter prints.
    embedded_code: () => custom("embed"),

    // printer-html.js's text: its words filled, the markers it prints joined to its ends.
    text: () =>
      fill("words", {
        sep: either(pred("literalText"), literalline, line),
        first: hook("prefix"),
        last: hook("suffix"),
      }),
    comment: () => [hook("prefix"), hook("text", "value"), hook("suffix")],
    // A node after a `<!-- prettier-ignore -->`, as written.
    ignored: () => [hook("prefix"), hook("text", "value"), hook("suffix")],
    doc_type: () => [
      hook("prefix"),
      either(pred("lent", "openStart"), [], hook("marker", "openStart")),
      hook("text", "value"),
      either(pred("lent", "closeEndToNext"), [], lit(">")),
      hook("suffix"),
    ],
    // A `<!--[if ...]><!-->` or `<!--<![endif]-->`.
    ie_conditional_marker: () => [openStart, closeEnd],

    plain_attribute: () => hook("text", "value"),
    // A value requoted with the quote it holds fewer of.
    quoted_attribute: () => [hook("text", "open"), hook("text", "value"), hook("text", "close")],
    // print/style.js: css declarations a line apart.
    style_attribute: ($) => expand(each($.children, { between: line })),
    declaration: ($) => [either(pred("blankBefore"), hardline, []), $.code],
    // CSS's tree, which its formatter prints, its `;` broken only after the last.
    css_declaration: () => custom("cssDeclaration"),
    // print/attribute/event-handler.js.
    event_handler_attribute: ($) => expand($.code),
    // JS's tree, which its formatter prints.
    js_program: () => custom("eventHandler"),
    // print/attribute/srcset.js: broken, each descriptor right-aligned on its integer part.
    srcset_attribute: ($) => expand(each($.children, { between: [lit(","), line] })),
    candidate: () => [
      hook("text", "url"),
      either(
        pred("hasDescriptor"),
        [ifBreak(hook("text", "pad")), ifFlat(lit(" ")), hook("text", "descriptor")],
        [],
      ),
    ],
    // print/attribute/allow.js: the directives a line apart after a `;`, the last one's only broken.
    allow_attribute: ($) => [
      hook("text", "open"),
      either(
        has("children"),
        group([indent([softline, each($.children, { between: [lit(";"), line] }), ifBreak(lit(";"))]), softline]),
        [],
      ),
      lit('"'),
    ],
    directive: () => hook("text", "value"),
  },
});
