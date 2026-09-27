jsonc compatibility: 7/9 (77.78%), 0 refused (ok:false), 0 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 5/9 (55.56%)

Fixtures: prettier 3.9.9 tests/format/{json/jsonc,json/with-comment} (recursive), every spec call listing parser `jsonc`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| json/jsonc/quote-props/test.jsonc | 0/3 | 50.00% |
| json/jsonc/single-quote/test.jsonc | 0/2 | 46.15% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
