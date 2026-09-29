json-stringify compatibility: 13/14 (92.86%), 1 refused (ok:false), 0 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 6/14 (42.86%)

Fixtures: prettier 3.9.9 tests/format/{json/json} (recursive), every spec call listing parser `json-stringify`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| json/json/json6.json | 1/1 | 84.34% | check: input "," at 686 is output as "]" at 862, which means "]", not "," |
