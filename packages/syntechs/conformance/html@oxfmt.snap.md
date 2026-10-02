html@oxfmt compatibility: 142/147 (96.60%), 5 refused (ok:false), 22 excluded

Fixtures: prettier 3.9.9 tests/format/{html} (recursive), every spec call listing parser `html`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| html/css/less.html | 1/1 | 94.12% | formatter-error: style lang less |
| html/css/scss.html | 1/1 | 84.38% | formatter-error: style lang scss |
| html/handlebars-venerable/template.html | 2/2 | 43.48% | formatter-error: script type text/x-handlebars-template |
| html/multiparser/markdown/html-with-markdown-script.html | 1/1 | 33.33% | formatter-error: script type text/markdown |
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
