html@oxfmt compatibility: 61/146 (41.78%), 62 refused (ok:false), 23 excluded

Fixtures: prettier 3.9.9 tests/format/{html} (recursive), every spec call listing parser `html`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| html/basics/broken-html.html | 0/1 | 72.73% |
| html/basics/empty.html | 0/1 | 0.00% |
| html/bracket-same-line/block.html | 1/2 | 83.33% |
| html/bracket-same-line/inline.html | 1/2 | 85.00% |
| html/bracket-same-line/void-elements.html | 1/2 | 75.00% |
| html/comments/comment-after-element.html | 2/4 | 66.54% |
| html/comments/conditional.html | 0/4 | 78.17% |
| html/comments/surrounding-empty-line.html | 0/4 | 82.72% |
| html/front-matter/custom-parser.html | 0/1 | 36.36% |
| html/front-matter/empty.html | 0/1 | 57.14% |
| html/front-matter/empty2.html | 0/1 | 57.14% |
| html/front-matter/issue-9042-no-empty-line.html | 0/1 | 0.00% |
| html/front-matter/issue-9042.html | 0/1 | 0.00% |
| html/front-matter/unicode.html | 0/1 | 50.00% |
| html/prettier_ignore/issue-15738.html | 0/1 | 85.71% |
| html/single-attribute-per-line/single-attribute-per-line.html | 1/2 | 91.79% |
| html/tags/closing-at-start.html | 3/4 | 93.18% |
| html/tags/openging-at-end.html | 2/4 | 74.11% |
| html/tags/option.html | 3/4 | 77.27% |
| html/tags/seach.html | 0/4 | 96.44% |
| html/tags/tags2.html | 2/4 | 73.87% |
| html/yaml/invalid.html | 0/1 | 58.82% |
| html/yaml/yaml.html | 0/1 | 71.43% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| html/attributes/event-attributes.html | 1/1 | 27.66% | formatter-error: onclick |
| html/attributes/smart-quotes.html | 1/1 | 100.00% | check: input "123 &apos;&quot; 456" at 82 is output as "123 '&quot; 456" at 75, which means "123 '&quot; 456", not "123  |
| html/attributes/srcset.html | 1/1 | 6.90% | formatter-error: srcset |
| html/attributes/style.html | 1/1 | 17.05% | formatter-error: style |
| html/attributes/iframe-allow-attribute/allow-attribute.html | 1/1 | 34.15% | formatter-error: allow |
| html/attributes/iframe-allow-attribute/small-print-width/allow-attribute.html | 1/1 | 0.00% | formatter-error: allow |
| html/attributes/no-semi/event-attributes.html | 1/1 | 30.77% | formatter-error: onclick |
| html/basics/html5-boilerplate.html | 1/1 | 46.60% | formatter-error: script_element |
| html/basics/with-colon.html | 1/1 | 20.27% | formatter-error: script_element |
| html/bracket-same-line/embed.html | 2/2 | 14.84% | formatter-error: script_element |
| html/case/case.html | 1/1 | 9.09% | formatter-error: CLASS |
| html/cdata/example.html | 1/1 | 54.55% | formatter-error: parse error |
| html/css/empty.html | 1/1 | 100.00% | formatter-error: style_element |
| html/css/less.html | 1/1 | 94.12% | formatter-error: style_element |
| html/css/postcss.html | 1/1 | 50.00% | formatter-error: style_element |
| html/css/scss.html | 1/1 | 84.38% | formatter-error: style_element |
| html/css/simple.html | 1/1 | 62.86% | formatter-error: style_element |
| html/css/single-style.html | 1/1 | 70.00% | formatter-error: style_element |
| html/cursor/cursor-1.html | 1/1 | 48.28% | formatter-error: script_element |
| html/cursor/cursor-2.html | 1/1 | 11.76% | formatter-error: script_element |
| html/cursor/cursor-3.html | 1/1 | 11.76% | formatter-error: script_element |
| html/cursor/cursor-4.html | 1/1 | 48.28% | formatter-error: script_element |
| html/cursor/cursor-5.html | 1/1 | 11.76% | formatter-error: script_element |
| html/cursor/cursor-6.html | 1/1 | 57.14% | formatter-error: script_element |
| html/cursor/cursor-7.html | 1/1 | 51.61% | formatter-error: script_element |
| html/cursor/cursor-8.html | 1/1 | 11.76% | formatter-error: script_element |
| html/doctype_declarations/xhtml1.1.html | 1/1 | 69.23% | formatter-error: style |
| html/handlebars-venerable/template.html | 2/2 | 43.48% | formatter-error: script_element |
| html/interpolation/example.html | 1/1 | 0.00% | formatter-error: parse error |
| html/js/empty.html | 1/1 | 100.00% | formatter-error: script_element |
| html/js/js.html | 1/1 | 75.00% | formatter-error: script_element |
| html/js/simple.html | 1/1 | 82.35% | formatter-error: script_element |
| html/js/single-script.html | 1/1 | 60.00% | formatter-error: script_element |
| html/js/something-else.html | 1/1 | 50.00% | formatter-error: script_element |
| html/js/template-literal.html | 1/1 | 38.71% | formatter-error: script_element |
| html/js/typescript.html | 1/1 | 67.07% | formatter-error: script_element |
| html/magic_comments/display.html | 1/1 | 36.36% | formatter-error: display: inline |
| html/multiparser/css/html-with-css-style.html | 1/1 | 34.78% | formatter-error: style_element |
| html/multiparser/js/html-with-js-script.html | 1/1 | 40.00% | formatter-error: script_element |
| html/multiparser/js/script-tag-escaping.html | 1/1 | 80.00% | formatter-error: script_element |
| html/multiparser/markdown/html-with-markdown-script.html | 1/1 | 33.33% | formatter-error: script_element |
| html/multiparser/ts/html-with-ts-script.html | 1/1 | 30.30% | formatter-error: script_element |
| html/multiparser/unknown/unknown-lang.html | 1/1 | 14.71% | formatter-error: style_element |
| html/prettier_ignore/cases.html | 1/1 | 100.00% | formatter-error: prettier-ignore |
| html/prettier_ignore/document.html | 1/1 | 95.35% | formatter-error: prettier-ignore |
| html/prettier_ignore/long_lines.html | 1/1 | 72.73% | formatter-error: prettier-ignore |
| html/prettier_ignore/unclosed2.html | 1/1 | 66.67% | formatter-error: prettier-ignore |
| html/script/babel.html | 1/1 | 42.11% | formatter-error: script_element |
| html/script/legacy.html | 1/1 | 43.48% | formatter-error: script_element |
| html/script/module-attributes.html | 1/1 | 100.00% | formatter-error: script_element |
| html/script/module.html | 1/1 | 35.29% | formatter-error: script_element |
| html/script/script.html | 1/1 | 65.06% | formatter-error: script_element |
| html/srcset/invalid.html | 1/1 | 42.11% | formatter-error: srcset |
| html/svg/svg.html | 1/1 | 61.33% | formatter-error: svg |
| html/svg/embeded/svg.html | 2/2 | 27.35% | formatter-error: svg |
| html/tags/marquee.html | 4/4 | 69.41% | formatter-error: style |
| html/tags/menu.html | 4/4 | 77.94% | formatter-error: onclick |
| html/tags/pre.html | 4/4 | 82.87% | formatter-error: parse error |
| html/tags/tags.html | 4/4 | 30.50% | formatter-error: on-click |
| html/whitespace/display-none.html | 1/1 | 0.00% | formatter-error: CLASS |
| html/whitespace/fill.html | 1/1 | 43.48% | formatter-error: style |
| html/whitespace/nested-inline-without-whitespace.html | 1/1 | 6.25% | formatter-error: style |

# Excluded

## oxfmt 0.70.0 rejects it: Failed to convert js number to serde_json::Number (20)

- html/comments/before-text.html {"printWidth":"Infinity"}
- html/comments/bogus.html {"printWidth":"Infinity"}
- html/comments/comment-after-element.html {"printWidth":"Infinity"}
- html/comments/conditional.html {"printWidth":"Infinity"}
- html/comments/for_debugging.html {"printWidth":"Infinity"}
- html/comments/hidden.html {"printWidth":"Infinity"}
- html/comments/surrounding-empty-line.html {"printWidth":"Infinity"}
- html/tags/case-sensitive.html {"printWidth":"Infinity"}
- html/tags/closing-at-start.html {"printWidth":"Infinity"}
- html/tags/custom-element.html {"printWidth":"Infinity"}
- html/tags/marquee.html {"printWidth":"Infinity"}
- html/tags/menu.html {"printWidth":"Infinity"}
- html/tags/openging-at-end.html {"printWidth":"Infinity"}
- html/tags/option.html {"printWidth":"Infinity"}
- html/tags/pre.html {"printWidth":"Infinity"}
- html/tags/seach.html {"printWidth":"Infinity"}
- html/tags/tags.html {"printWidth":"Infinity"}
- html/tags/tags2.html {"printWidth":"Infinity"}
- html/tags/textarea.html {"printWidth":"Infinity"}
- html/tags/unsupported.html {"printWidth":"Infinity"}

## oxfmt 0.70.0 rejects it: SyntaxError: Opening tag "div" not terminated. (1:1) (2)

- html/_errors_/start-tag-comments/block-comment.html
- html/_errors_/start-tag-comments/line-comment.html

## oxfmt 0.70.0 rejects it: Unsupported file type: html/svg/embeded/svg.svg (1)

- html/svg/embeded/svg.svg
