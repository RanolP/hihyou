yaml@oxfmt compatibility: 345/360 (95.83%), 15 refused (ok:false), 1 excluded

Fixtures: prettier 3.9.9 tests/format/{yaml} (recursive), every spec call listing parser `yaml`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| yaml/block-folded/block-folded-keep.yml | 2/2 | 0.00% | formatter-error: a comment after a kept block scalar ending the stream |
| yaml/block-folded/block-folded-strip.yml | 2/2 | 18.18% | formatter-error: a whitespace line past the content indent ending the stream |
| yaml/comment/end-comment.yml | 1/1 | 69.23% | formatter-error: a comment between a nested block and its parent |
| yaml/comment/flow-sequence-mapping.yml | 1/1 | 39.39% | formatter-error: a comment before a flow value |
| yaml/flow-sequence/array-value.yml | 3/3 | 0.00% | formatter-error: a flow collection after an empty key |
| yaml/mapping/explicit-key.yml | 2/2 | 39.13% | formatter-error: a comment after an explicit pair's colon |
| yaml/prettier-ignore/document.yml | 1/1 | 76.92% | formatter-error: a prettier-ignore comment before no block item |
| yaml/prettier-ignore/trailing-comma.yml | 1/1 | 44.44% | formatter-error: a prettier-ignore comment before no block item |
| yaml/spec/block-scalar-keep.yml | 2/2 | 0.00% | formatter-error: a comment after a kept block scalar ending the stream |
| yaml/spec/spec-example-6-1-indentation-spaces.yml | 1/2 | 62.00% | formatter-error: a broken flow collection under proseWrap |
| yaml/spec/spec-example-7-14-flow-sequence-entries.yml | 2/2 | 11.11% | formatter-error: a multi-line double quote_scalar |
| yaml/spec/spec-example-7-20-single-pair-explicit-entry.yml | 2/2 | 22.22% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-8-5-chomping-trailing-lines.yml | 2/2 | 47.37% | formatter-error: a comment between a nested block and its parent |
| yaml/spec/spec-example-9-4-explicit-documents.yml | 2/2 | 67.87% | formatter-error: a multi-line plain scalar |
| yaml/spec/various-trailing-comments.yml | 2/2 | 43.05% | formatter-error: a comment before an explicit key that is no scalar |

# Excluded

## oxfmt 0.70.0 rejects it: Syntax error: invalid block scalar indentation (1)

- yaml/_errors_/block-scalar-with-spaces-only.yml
