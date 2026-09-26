json-stringify compatibility: 7/14 (50.00%), 0 refused (ok:false), 0 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 6/14 (42.86%)
- dprint dprint-plugin-json 0.24.0: 6/14 (42.86%)

Fixtures: prettier 3.9.9 tests/format/{json/json} (recursive), every spec call listing parser `json-stringify`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| json/json/array.json | 0/1 | 36.36% |
| json/json/json5.json | 0/1 | 7.84% |
| json/json/json6.json | 0/1 | 27.07% |
| json/json/pass1.json | 0/1 | 1.50% |
| json/json/positive-number.json | 0/1 | 0.00% |
| json/json/propertyKey.json | 0/1 | 8.16% |
| json/json/single-quote.json | 0/1 | 0.00% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
