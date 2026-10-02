svg@oxfmt compatibility: 615/636 (96.70%), 10 refused (ok:false), 3 excluded

Fixtures: svgo 3.3.2 test/**/*.svg (each plugin test's input, before its `@@@`) and logo/, feather 4.29.2 icons/, and src/grammars/html/svg-corpus; expected output from oxfmt 0.70.0 run on each named `.html` (oxfmt takes no `.svg`), excluded when oxfmt rejects it or does not keep its own output.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| svgo-3.3.2/test/plugins/cleanupIds.03.svg | 0/1 | 88.89% |
| svgo-3.3.2/test/plugins/cleanupIds.07.svg | 0/1 | 88.89% |
| svgo-3.3.2/test/plugins/inlineStyles.13.svg | 0/1 | 97.64% |
| svgo-3.3.2/test/plugins/removeEditorsNSData.01.svg | 0/1 | 87.50% |
| svgo-3.3.2/test/plugins/removeEditorsNSData.02.svg | 0/1 | 87.50% |
| svgo-3.3.2/test/plugins/removeUnknownsAndDefaults.02.svg | 0/1 | 80.00% |
| svgo-3.3.2/test/plugins/removeUnknownsAndDefaults.07.svg | 0/1 | 88.89% |
| svgo-3.3.2/test/plugins/removeUnusedNS.05.svg | 0/1 | 88.89% |
| svgo-3.3.2/test/plugins/removeUnusedNS.06.svg | 0/1 | 88.89% |
| svgo-3.3.2/test/svgo/pre-element-pretty.svg | 0/1 | 43.75% |
| svgo-3.3.2/test/svgo/pre-element.svg | 0/1 | 43.75% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| svgo-3.3.2/test/plugins/cleanupIds.06.svg | 1/1 | 13.33% | formatter-error: css parse error |
| svgo-3.3.2/test/plugins/convertStyleToAttrs.01.svg | 1/1 | 100.00% | check: input "font-family:'Helvetica Neue'" at 83 is output as "font-family: &quot;Helvetica Neue&quot;" at 80, which me |
| svgo-3.3.2/test/plugins/inlineStyles.10.svg | 1/1 | 25.00% | formatter-error: css parse error |
| svgo-3.3.2/test/plugins/mergeStyles.11.svg | 1/1 | 17.39% | formatter-error: css parse error |
| svgo-3.3.2/test/plugins/minifyStyles.02.svg | 1/1 | 13.79% | formatter-error: css parse error |
| svgo-3.3.2/test/plugins/minifyStyles.03.svg | 1/1 | 14.81% | formatter-error: css parse error |
| svgo-3.3.2/test/plugins/prefixIds.12.svg | 1/1 | 61.54% | formatter-error: css parse error |
| svgo-3.3.2/test/plugins/removeUselessStrokeAndFill.03.svg | 1/1 | 11.76% | formatter-error: css parse error |
| svgo-3.3.2/test/svg2js/test.svg | 1/1 | 29.79% | formatter-error: css parse error |
| src/grammars/html/svg-corpus/style-cdata.svg | 1/1 | 34.48% | formatter-error: css parse error |

# Excluded

## oxfmt 0.70.0 rejects it: SyntaxError: Opening tag ":svg:rect" not terminated. (2:3) (1)

- svgo-3.3.2/test/cli/invalid.svg

## oxfmt 0.70.0 rejects it: SyntaxError: Opening tag ":svg:svg" not terminated. (1:1) (1)

- svgo-3.3.2/test/svgo/invalid.svg

## oxfmt 0.70.0 rejects it: SyntaxError: Unknown entity "Viewport" - use the "&#<decimal> (1)

- svgo-3.3.2/test/svgo/entities.svg
