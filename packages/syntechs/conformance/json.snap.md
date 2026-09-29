json compatibility: 18/20 (90.00%), 1 refused (ok:false), 0 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 19/20 (95.00%)

Fixtures: prettier 3.9.9 tests/format/{json/json,json/with-comment} (recursive), every spec call listing parser `json`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| json/json/pass1.json | 0/3 | 99.16% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| json/json/json6.json | 3/3 | 97.96% | check: input "," at 686 is output as "]" at 749, which means "]", not "," |
