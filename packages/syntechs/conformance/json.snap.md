json compatibility: 13/20 (65.00%), 0 refused (ok:false), 0 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 19/20 (95.00%)
- dprint dprint-plugin-json 0.24.0: 14/20 (70.00%)

Fixtures: prettier 3.9.9 tests/format/{json/json,json/with-comment} (recursive), every spec call listing parser `json`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| json/json/array.json | 0/3 | 0.00% |
| json/json/json5.json | 0/3 | 8.51% |
| json/json/json6.json | 0/3 | 41.67% |
| json/json/pass1.json | 0/3 | 5.08% |
| json/json/positive-number.json | 0/3 | 66.67% |
| json/json/propertyKey.json | 0/3 | 8.16% |
| json/json/single-quote.json | 0/3 | 0.00% |

# Refused (ok:false)

The formatter's self-check rejected its own output, so it returned the input unchanged.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
