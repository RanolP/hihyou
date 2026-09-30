css compatibility: 141/151 (93.38%), 0 refused (ok:false), 6 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 129/151 (85.43%)

Fixtures: prettier 3.9.9 tests/format/{css} (recursive), every spec call listing parser `css`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| css/comments/declaration.css | 0/1 | 98.88% |
| css/fill-value/fill.css | 0/1 | 96.36% |
| css/parens/empty-lines.css | 0/1 | 31.58% |
| css/parens/parens.css | 0/1 | 93.13% |
| css/postcss-8-improment/test.css | 0/1 | 88.24% |
| css/postcss-plugins/postcss-nesting.css | 0/1 | 97.66% |
| css/postcss-plugins/postcss-simple-vars.css | 0/1 | 77.78% |
| css/stylefmt-repo/at-media/at-media.css | 0/1 | 95.24% |
| css/stylefmt-repo/cssnext-example/cssnext-example.css | 0/1 | 98.31% |
| css/stylefmt-repo/media-queries-ranges/media-queries-ranges.css | 0/1 | 90.91% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

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
