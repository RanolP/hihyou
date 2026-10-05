svg@oxfmt compatibility: 636/636 (100.00%), 0 refused (ok:false), 3 excluded

Fixtures: svgo 3.3.2 test/**/*.svg (each plugin test's input, before its `@@@`) and logo/, feather 4.29.2 icons/, and src/grammars/html/svg-corpus; expected output from oxfmt 0.70.0 run on each named `.html` (oxfmt takes no `.svg`), excluded when oxfmt rejects it or does not keep its own output.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## oxfmt 0.70.0 rejects it: SyntaxError: Opening tag ":svg:rect" not terminated. (2:3) (1)

- svgo-3.3.2/test/cli/invalid.svg

## oxfmt 0.70.0 rejects it: SyntaxError: Opening tag ":svg:svg" not terminated. (1:1) (1)

- svgo-3.3.2/test/svgo/invalid.svg

## oxfmt 0.70.0 rejects it: SyntaxError: Unknown entity "Viewport" - use the "&#<decimal> (1)

- svgo-3.3.2/test/svgo/entities.svg
