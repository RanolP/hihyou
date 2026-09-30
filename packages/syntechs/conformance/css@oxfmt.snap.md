css@oxfmt compatibility: 129/138 (93.48%), 0 refused (ok:false), 19 excluded

Fixtures: those of the css target, every option set, expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults. A fixture oxfmt rejects under any of its option sets is excluded.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| css/comments/declaration.css | 0/1 | 98.88% |
| css/fill-value/fill.css | 0/1 | 96.36% |
| css/parens/empty-lines.css | 0/1 | 31.58% |
| css/parens/parens.css | 0/1 | 93.13% |
| css/postcss-8-improment/test.css | 0/1 | 88.24% |
| css/postcss-plugins/postcss-nesting.css | 0/1 | 97.66% |
| css/stylefmt-repo/at-media/at-media.css | 0/1 | 95.24% |
| css/stylefmt-repo/cssnext-example/cssnext-example.css | 0/1 | 98.31% |
| css/stylefmt-repo/media-queries-ranges/media-queries-ranges.css | 0/1 | 90.91% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## cursor or range formatting (2)

- css/cursor/test.css
- css/range/issue2267.css

## ignored syntax (not in the grammar or not the parser's) (2)

- css/atrule/if-else.css
- css/yaml/dirty.css

## oxfmt 0.70.0 rejects it: Syntax error: declaration at top level is disallowed (2)

- css/custom-properties/emoji.css
- css/postcss-plugins/postcss-simple-vars.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `)`, but found `<` (1)

- css/atrule/supports.css

## oxfmt 0.70.0 rejects it: Syntax error: expect token `]`, but found `(` (1)

- css/attribute/quotes.css

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

## the spec expects the parser to reject it (2)

- css/_errors_/less-syntax.css
- css/_errors_/scss-syntax.css
