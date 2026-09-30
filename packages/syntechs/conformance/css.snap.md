css compatibility: 135/151 (89.40%), 1 refused (ok:false), 6 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 115/151 (76.16%)

Fixtures: prettier 3.9.9 tests/format/{css} (recursive), every spec call listing parser `css`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| css/atrule/import.css | 0/1 | 45.09% |
| css/atrule/supports.css | 0/1 | 14.39% |
| css/atword/atword.css | 0/1 | 66.67% |
| css/color/color-adjuster.css | 0/1 | 96.77% |
| css/comments/17479.css | 0/1 | 46.51% |
| css/comments/at-rules.css | 0/1 | 60.18% |
| css/comments/declaration.css | 0/1 | 77.78% |
| css/comments/selectors.css | 0/1 | 71.64% |
| css/modules/modules.css | 0/1 | 99.20% |
| css/parens/parens.css | 0/1 | 83.13% |
| css/postcss-8-improment/test.css | 0/1 | 80.00% |
| css/postcss-plugins/postcss-simple-vars.css | 0/1 | 73.68% |
| css/selector-list/selectors.css | 0/1 | 76.15% |
| css/stylefmt-repo/at-media/at-media.css | 0/1 | 95.24% |
| css/url/url.css | 0/1 | 90.00% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| css/font/font.css | 1/1 | 100.00% | check: input "1rem" at 707 is output as "1" at 661, which means "1e0", not "1e0rem" |

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
