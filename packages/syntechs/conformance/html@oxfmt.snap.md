html@oxfmt compatibility: 116/146 (79.45%), 22 refused (ok:false), 23 excluded

Fixtures: prettier 3.9.9 tests/format/{html} (recursive), every spec call listing parser `html`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| html/basics/broken-html.html | 0/1 | 72.73% |
| html/basics/html5-boilerplate.html | 0/1 | 95.08% |
| html/comments/conditional.html | 0/4 | 79.76% |
| html/comments/surrounding-empty-line.html | 0/4 | 93.86% |
| html/multiparser/js/script-tag-escaping.html | 0/1 | 80.00% |
| html/prettier_ignore/issue-15738.html | 0/1 | 85.71% |
| html/script/babel.html | 0/1 | 92.86% |
| html/script/legacy.html | 0/1 | 84.21% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| html/attributes/event-attributes.html | 1/1 | 27.66% | formatter-error: onclick |
| html/attributes/smart-quotes.html | 1/1 | 100.00% | check: input "123 &apos;&quot; 456" at 82 is output as "123 '&quot; 456" at 75, which means "123 '&quot; 456", not "123  |
| html/attributes/srcset.html | 1/1 | 6.90% | formatter-error: srcset |
| html/attributes/no-semi/event-attributes.html | 1/1 | 30.77% | formatter-error: onclick |
| html/basics/with-colon.html | 1/1 | 20.27% | formatter-error: svg |
| html/cdata/example.html | 1/1 | 54.55% | formatter-error: parse error |
| html/css/less.html | 1/1 | 94.12% | formatter-error: style lang less |
| html/css/scss.html | 1/1 | 84.38% | formatter-error: style lang scss |
| html/handlebars-venerable/template.html | 2/2 | 43.48% | formatter-error: script type text/x-handlebars-template |
| html/interpolation/example.html | 1/1 | 0.00% | formatter-error: parse error |
| html/multiparser/markdown/html-with-markdown-script.html | 1/1 | 33.33% | formatter-error: script type text/markdown |
| html/prettier_ignore/cases.html | 1/1 | 100.00% | formatter-error: prettier-ignore |
| html/prettier_ignore/document.html | 1/1 | 95.35% | formatter-error: prettier-ignore |
| html/prettier_ignore/long_lines.html | 1/1 | 72.73% | formatter-error: prettier-ignore |
| html/prettier_ignore/unclosed2.html | 1/1 | 66.67% | formatter-error: prettier-ignore |
| html/script/script.html | 1/1 | 65.06% | formatter-error: script type text/html |
| html/srcset/invalid.html | 1/1 | 42.11% | formatter-error: srcset |
| html/svg/svg.html | 1/1 | 61.33% | formatter-error: svg |
| html/svg/embeded/svg.html | 2/2 | 27.35% | formatter-error: svg |
| html/tags/menu.html | 4/4 | 77.94% | formatter-error: onclick |
| html/tags/pre.html | 4/4 | 82.87% | formatter-error: parse error |
| html/yaml/invalid.html | 1/1 | 73.68% | formatter-error: yaml front matter |

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
