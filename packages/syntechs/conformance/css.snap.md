css compatibility: 147/151 (97.35%), 0 refused (ok:false), 6 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 129/151 (85.43%)

Fixtures: prettier 3.9.9 tests/format/{css} (recursive), every spec call listing parser `css`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| css/atrule/supports.css | 0/1 | 14.41% |
| css/comments/at-rules.css | 0/1 | 63.44% |
| css/parens/parens.css | 0/1 | 95.00% |
| css/postcss-plugins/postcss-simple-vars.css | 0/1 | 77.78% |

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
