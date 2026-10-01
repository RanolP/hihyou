css@oxfmt compatibility: 140/142 (98.59%), 0 refused (ok:false), 15 excluded

Fixtures: prettier 3.9.9 tests/format/{css} (recursive), every spec call listing parser `css`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| css/atrule/if-else.css | 0/1 | 50.00% |
| css/yaml/dirty.css | 0/1 | 66.67% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## oxfmt 0.70.0 rejects it: Syntax error: a top-level `{}` block is disallowed in a declaration value (1)

- css/_errors_/scss-syntax.css

## oxfmt 0.70.0 rejects it: Syntax error: declaration at top level is disallowed (2)

- css/custom-properties/emoji.css
- css/postcss-plugins/postcss-simple-vars.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `)`, but found `<` (1)

- css/atrule/supports.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `]`, but found `(` (1)

- css/attribute/quotes.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `{`, but found `(` (1)

- css/_errors_/less-syntax.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `{`, but found `/` (1)

- css/combinator/combinator.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `{`, but found `<string>` (1)

- css/quotes/quotes.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `{`, but found `<unknown>` (1)

- css/postcss-plugins/postcss-mixins.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `<ident>`, but found `(` (1)

- css/atrule/import.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `<string>`, but found `<ident>` (1)

- css/atrule/charset.css

## oxfmt 0.70.0 rejects it: Syntax error: simple selector is expected (3)

- css/comments/selectors.css
- css/selector-list/selectors.css
- css/selector-string/string.css

## oxfmt 0.70.0 rejects it: Syntax error: URL is expected (1)

- css/no-semicolon/url.css
