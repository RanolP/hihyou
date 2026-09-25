css compatibility: 65/151 (43.05%), 1 refused (ok:false), 6 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 115/151 (76.16%)
- dprint dprint_plugin_malva 0.16.0: 50/151 (33.11%)

Fixtures: prettier 3.9.9 tests/format/{css} (recursive), every spec call listing parser `css`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| css/atrule/at-root.css | 0/1 | 79.16% |
| css/atrule/custom-media.css | 0/1 | 4.84% |
| css/atrule/custom-selector.css | 0/1 | 8.85% |
| css/atrule/debug.css | 0/1 | 12.90% |
| css/atrule/each.css | 0/1 | 4.90% |
| css/atrule/extend.css | 0/1 | 41.30% |
| css/atrule/font-feature-values.css | 0/1 | 21.69% |
| css/atrule/for.css | 0/1 | 0.00% |
| css/atrule/function.css | 0/1 | 17.32% |
| css/atrule/import.css | 0/1 | 45.09% |
| css/atrule/include.css | 0/1 | 34.48% |
| css/atrule/media.css | 0/1 | 94.66% |
| css/atrule/mixin.css | 0/1 | 8.89% |
| css/atrule/page.css | 0/1 | 61.54% |
| css/atrule/return.css | 0/1 | 29.89% |
| css/atrule/supports.css | 0/1 | 14.39% |
| css/atrule/while.css | 0/1 | 7.65% |
| css/attribute/custom-selector.css | 0/2 | 5.00% |
| css/attribute/insensitive.css | 0/2 | 72.22% |
| css/attribute/sensitive.css | 0/2 | 55.88% |
| css/attribute/spaces.css | 0/2 | 40.98% |
| css/atword/atword.css | 0/1 | 0.00% |
| css/bom/bom.css | 0/1 | 72.73% |
| css/case/case.css | 0/1 | 98.41% |
| css/case/custom-selectors.css | 0/1 | 90.91% |
| css/character-escaping/character_escaping.css | 0/1 | 16.56% |
| css/color/color-adjuster.css | 0/1 | 96.77% |
| css/comments/15948.css | 0/1 | 16.67% |
| css/comments/17479.css | 0/1 | 46.51% |
| css/comments/custom-properties.css | 0/1 | 53.85% |
| css/comments/declaration.css | 0/1 | 60.12% |
| css/comments/prettier-ignore.css | 0/1 | 80.00% |
| css/comments/selectors.css | 0/1 | 52.82% |
| css/comments/types.css | 0/1 | 92.86% |
| css/composes/composes.css | 0/1 | 57.14% |
| css/custom-properties/emoji.css | 0/1 | 83.33% |
| css/empty/empty.css | 0/1 | 85.71% |
| css/escaped-attribute/test.css | 0/1 | 87.50% |
| css/fill-value/fill.css | 0/1 | 84.62% |
| css/font/font.css | 0/1 | 79.41% |
| css/front-matter/custom-parser.css | 0/1 | 26.67% |
| css/front-matter/empty.css | 0/1 | 36.36% |
| css/front-matter/embedded-language-formatting/yaml.css | 0/1 | 18.18% |
| css/grid/grid.css | 0/1 | 94.64% |
| css/indent/indent.css | 0/1 | 78.26% |
| css/inline-url/inline_url.css | 0/1 | 91.84% |
| css/modules/modules.css | 0/1 | 99.20% |
| css/numbers/numbers.css | 0/1 | 34.67% |
| css/parens/empty-lines.css | 0/1 | 30.00% |
| css/parens/parens.css | 0/1 | 54.25% |
| css/postcss-8-improment/empty-props.css | 0/1 | 50.00% |
| css/postcss-8-improment/test.css | 0/1 | 80.00% |
| css/postcss-plugins/postcss-mixins.css | 0/1 | 49.23% |
| css/postcss-plugins/postcss-nested-props.css | 0/1 | 53.85% |
| css/postcss-plugins/postcss-nested.css | 0/1 | 28.57% |
| css/postcss-plugins/postcss-nesting.css | 0/1 | 94.86% |
| css/postcss-plugins/postcss-simple-vars.css | 0/1 | 73.68% |
| css/quotes/quotes.css | 0/2 | 74.59% |
| css/selector-list/selectors.css | 0/1 | 76.15% |
| css/stylefmt-repo/at-media/at-media.css | 0/1 | 95.24% |
| css/stylefmt-repo/cssnext-example/cssnext-example.css | 0/1 | 95.00% |
| css/stylefmt-repo/custom-media-queries/custom-media-queries.css | 0/1 | 70.59% |
| css/stylefmt-repo/custom-selectors/custom-selectors.css | 0/1 | 23.53% |
| css/stylefmt-repo/ie-hacks/ie-hacks.css | 0/1 | 43.48% |
| css/stylefmt-repo/important/important.css | 0/1 | 66.67% |
| css/stylefmt-repo/lowercase/lowercase.css | 0/1 | 29.55% |
| css/stylefmt-repo/media-queries-ranges/media-queries-ranges.css | 0/1 | 90.91% |
| css/stylefmt-repo/nested-indention/nested-indention.css | 0/1 | 28.24% |
| css/stylefmt-repo/nested-indention-2/nested-indention-2.css | 0/1 | 34.15% |
| css/stylefmt-repo/nested-mixin/nested-mixin.css | 0/1 | 88.00% |
| css/stylefmt-repo/nested-mixin-2/nested-mixin-2.css | 0/1 | 25.00% |
| css/stylefmt-repo/non-nested-combinator/non-nested-combinator.css | 0/1 | 86.96% |
| css/stylefmt-repo/shorthand-with-sass-variables/shorthand-with-sass-variables.css | 0/1 | 66.67% |
| css/trailing-comma/var-func.css | 0/1 | 57.14% |
| css/url/url.css | 0/1 | 90.00% |
| css/variables/apply-rule.css | 0/1 | 92.06% |
| css/yaml/comment_after.css | 0/1 | 26.67% |
| css/yaml/empty.css | 0/1 | 44.44% |
| css/yaml/empty_newlines.css | 0/1 | 44.44% |
| css/yaml/ignore.css | 0/1 | 16.67% |
| css/yaml/malformed-2.css | 0/1 | 66.67% |
| css/yaml/only_comments.css | 0/1 | 88.89% |
| css/yaml/with_comments.css | 0/1 | 33.33% |
| css/yaml/without-newline-after.css | 0/1 | 36.36% |
| css/yaml/yaml.css | 0/1 | 36.36% |

# Refused (ok:false)

The formatter's self-check rejected its own output, so it returned the input unchanged.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| css/comments/at-rules.css | 1/1 | 22.55% | token-mismatch: input at 1422 dropped |

# Excluded

## cursor or range formatting (2)

- css/cursor/test.css
- css/range/issue2267.css

## ignored syntax (not in the grammar or not the parser's) (2)

- css/atrule/if-else.css
- css/yaml/dirty.css

## the spec expects the parser to reject it (2)

- css/_errors_/less-syntax.css
- css/_errors_/scss-syntax.css
