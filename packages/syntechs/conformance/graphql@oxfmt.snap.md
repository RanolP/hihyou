graphql@oxfmt compatibility: 58/58 (100.00%), 0 refused (ok:false), 2 excluded

Fixtures: prettier 3.9.9 tests/format/{graphql} (recursive), every spec call listing parser `graphql`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## oxfmt 0.70.0 rejects it: Syntax error: expected definition (1)

- graphql/_errors_/type-interfaces.graphql

## oxfmt 0.70.0 rejects it: Syntax error: Unexpected description, descriptions are not supported on shorthand queries. (1)

- graphql/_errors_/descriptions-on-a-short-hand-query.graphql
