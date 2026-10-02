yaml@oxfmt compatibility: 360/360 (100.00%), 0 refused (ok:false), 1 excluded

Fixtures: prettier 3.9.9 tests/format/{yaml} (recursive), every spec call listing parser `yaml`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## oxfmt 0.70.0 rejects it: Syntax error: invalid block scalar indentation (1)

- yaml/_errors_/block-scalar-with-spaces-only.yml
