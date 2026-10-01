yaml@oxfmt compatibility: 127/360 (35.28%), 233 refused (ok:false), 1 excluded

Fixtures: prettier 3.9.9 tests/format/{yaml} (recursive), every spec call listing parser `yaml`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| yaml/block-folded/block-folded-keep.yml | 2/2 | 0.00% | formatter-error: content on a marker line |
| yaml/block-folded/block-folded-strip.yml | 2/2 | 18.18% | formatter-error: content on a marker line |
| yaml/block-folded/clip.yml | 2/2 | 22.50% | formatter-error: a block_scalar |
| yaml/block-folded/empty-line-after-block-scalar.yml | 2/2 | 86.36% | formatter-error: a block_scalar |
| yaml/block-folded/indent.yml | 2/2 | 80.00% | formatter-error: a block_scalar |
| yaml/block-folded/keep.yml | 2/2 | 55.00% | formatter-error: a block_scalar |
| yaml/block-folded/map.yml | 2/2 | 83.33% | formatter-error: a block_scalar |
| yaml/block-folded/middle-comment.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-folded/middle-comments.yml | 2/2 | 66.67% | formatter-error: a block_scalar |
| yaml/block-folded/newline-unaligned.yml | 2/2 | 77.78% | formatter-error: a block_scalar |
| yaml/block-folded/newline.yml | 2/2 | 75.00% | formatter-error: a block_scalar |
| yaml/block-folded/props-in-map.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-folded/props.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-folded/prose.yml | 2/2 | 52.63% | formatter-error: a block_scalar |
| yaml/block-folded/seq.yml | 2/2 | 87.50% | formatter-error: a block_scalar |
| yaml/block-folded/strip.yml | 2/2 | 22.50% | formatter-error: a block_scalar |
| yaml/block-folded/trailing-comment.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/clip.yml | 2/2 | 20.00% | formatter-error: a block_scalar |
| yaml/block-literal/indent.yml | 2/2 | 80.00% | formatter-error: a block_scalar |
| yaml/block-literal/keep.yml | 2/2 | 50.00% | formatter-error: a block_scalar |
| yaml/block-literal/map.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/middle-comment.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/middle-comments.yml | 2/2 | 66.67% | formatter-error: a block_scalar |
| yaml/block-literal/newline-unaligned.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/newline.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/props-in-map.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/props.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/seq.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/block-literal/strip.yml | 2/2 | 20.00% | formatter-error: a block_scalar |
| yaml/block-literal/trailing-comment.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/comment/collection.yml | 1/1 | 100.00% | formatter-error: a comment before a scalar value |
| yaml/comment/end-comment.yml | 1/1 | 69.23% | formatter-error: a comment between a nested block and its parent |
| yaml/comment/flow-sequence-mapping.yml | 1/1 | 39.39% | formatter-error: a prettier-ignore comment |
| yaml/comment/issue-16074.yml | 1/1 | 100.00% | formatter-error: a flow_mapping |
| yaml/document/with-document-head-like.yml | 1/1 | 100.00% | formatter-error: a multi-line plain scalar |
| yaml/flow-mapping/alias-key.yml | 3/3 | 33.33% | formatter-error: a flow_mapping |
| yaml/flow-mapping/array-key-array-value.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/array-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-mapping/array-plain.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/array-value.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/comment-between.yml | 3/3 | 40.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/comment-trailing.yml | 3/3 | 40.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/empty-item-colon.yml | 3/3 | 66.67% | formatter-error: a flow_mapping |
| yaml/flow-mapping/empty-line-collapse.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/empty-line.yml | 3/3 | 25.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/empty.yml | 3/3 | 100.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/long-key-long-value.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/long-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-mapping/long-plain.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/long-value.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/middle-comment.yml | 3/3 | 100.00% | formatter-error: a comment after properties |
| yaml/flow-mapping/middle-comments.yml | 3/3 | 57.14% | formatter-error: a comment after properties |
| yaml/flow-mapping/next-empty-line.yml | 3/3 | 54.55% | formatter-error: a flow_mapping |
| yaml/flow-mapping/props-in-map.yml | 3/3 | 33.33% | formatter-error: a flow_mapping |
| yaml/flow-mapping/props.yml | 3/3 | 33.33% | formatter-error: a flow_mapping |
| yaml/flow-mapping/short-key-short-value.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/short-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-mapping/short-plain.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/short-value.yml | 3/3 | 0.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/very-long-value.yml | 3/3 | 66.67% | formatter-error: a flow_mapping |
| yaml/flow-mapping/comments/key.yml | 1/1 | 25.00% | formatter-error: a flow_mapping |
| yaml/flow-mapping/trailing-comma/flow-mapping.yml | 4/4 | 74.24% | formatter-error: a flow_mapping |
| yaml/flow-sequence/alias-key.yml | 3/3 | 100.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/array-key-array-value.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/array-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-sequence/array-plain.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/array-value.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/comment-between.yml | 3/3 | 40.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/comment-trailing.yml | 3/3 | 40.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/empty-item-colon.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/empty-line-collapse.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/empty-line.yml | 3/3 | 25.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/empty.yml | 3/3 | 100.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/long-key-long-value.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/long-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-sequence/long-plain.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/long-value.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/middle-comment.yml | 3/3 | 100.00% | formatter-error: a comment after properties |
| yaml/flow-sequence/middle-comments.yml | 3/3 | 57.14% | formatter-error: a comment after properties |
| yaml/flow-sequence/next-empty-line.yml | 3/3 | 54.55% | formatter-error: a flow_sequence |
| yaml/flow-sequence/props-in-map.yml | 3/3 | 100.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/props.yml | 3/3 | 100.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/short-key-short-value.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/short-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-sequence/short-plain.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/short-value.yml | 3/3 | 0.00% | formatter-error: a flow_sequence |
| yaml/flow-sequence/trailing-comma/flow-sequence.yml | 4/4 | 62.86% | formatter-error: a flow_sequence |
| yaml/json/trailing-comma/json.yml | 4/4 | 50.00% | formatter-error: a flow_sequence |
| yaml/mapping/3-style.yml | 2/2 | 42.86% | formatter-error: a flow_sequence |
| yaml/mapping/array-key.yml | 2/2 | 100.00% | formatter-error: a flow_sequence |
| yaml/mapping/array-value.yml | 2/2 | 100.00% | formatter-error: a flow_sequence |
| yaml/mapping/comment.yml | 2/2 | 100.00% | formatter-error: a pair without a key |
| yaml/mapping/explicit-key.yml | 2/2 | 39.13% | formatter-error: a pair without a key |
| yaml/mapping/key-with-leading-comment.yml | 2/2 | 100.00% | formatter-error: a pair without a key |
| yaml/mapping/middle-comment.yml | 2/2 | 100.00% | formatter-error: a comment after root properties |
| yaml/mapping/middle-comments.yml | 2/2 | 57.14% | formatter-error: a comment after root properties |
| yaml/mapping/props.yml | 2/2 | 40.00% | formatter-error: content on a marker line |
| yaml/mapping/tag-key.yml | 2/2 | 0.00% | formatter-error: a pair without a key |
| yaml/mapping/duplicated-keys/flow-mapping.yml | 1/1 | 21.05% | formatter-error: a flow_mapping |
| yaml/mapping/duplicated-keys/mapping.yml | 1/1 | 72.73% | formatter-error: a pair without a key |
| yaml/mapping/long-key/test.yml | 1/2 | 50.00% | formatter-error: a line past printWidth under proseWrap |
| yaml/plain/force-singleline-in-mapping-value.yml | 3/3 | 84.59% | formatter-error: a multi-line plain scalar |
| yaml/plain/middle-comment.yml | 3/3 | 100.00% | formatter-error: a comment after properties |
| yaml/plain/middle-comments.yml | 3/3 | 57.14% | formatter-error: a comment after properties |
| yaml/plain/multiline.yml | 3/3 | 0.00% | formatter-error: a multi-line plain scalar |
| yaml/prettier-ignore/document.yml | 1/1 | 76.92% | formatter-error: a prettier-ignore comment |
| yaml/prettier-ignore/leading-comment.yml | 1/1 | 66.67% | formatter-error: a prettier-ignore comment |
| yaml/prettier-ignore/middle-comment.yml | 1/1 | 60.00% | formatter-error: a prettier-ignore comment |
| yaml/prettier-ignore/trailing-comma.yml | 1/1 | 44.44% | formatter-error: a prettier-ignore comment |
| yaml/prettier-ignore/trailing-comment.yml | 1/1 | 66.67% | formatter-error: a prettier-ignore comment |
| yaml/quote/multiline.yml | 4/4 | 0.00% | formatter-error: a multi-line quoted scalar |
| yaml/root/example.yml | 1/1 | 82.61% | formatter-error: a flow_mapping |
| yaml/sequence/middle-comment.yml | 2/2 | 100.00% | formatter-error: a comment after root properties |
| yaml/sequence/middle-comments.yml | 2/2 | 57.14% | formatter-error: a comment after root properties |
| yaml/sequence/props.yml | 2/2 | 57.14% | formatter-error: content on a marker line |
| yaml/spec/aliases-in-explicit-block-mapping.yml | 2/2 | 40.00% | formatter-error: a pair without a key |
| yaml/spec/allowed-characters-in-plain-scalars.yml | 2/2 | 70.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/blank-lines.yml | 2/2 | 83.33% | formatter-error: a block_scalar |
| yaml/spec/block-mapping-with-missing-values.yml | 2/2 | 33.33% | formatter-error: a pair without a key |
| yaml/spec/block-mapping-with-multiline-scalars.yml | 2/2 | 50.00% | formatter-error: a pair without a key |
| yaml/spec/block-scalar-indicator-order.yml | 2/2 | 75.00% | formatter-error: a block_scalar |
| yaml/spec/block-scalar-keep.yml | 2/2 | 0.00% | formatter-error: content on a marker line |
| yaml/spec/block-scalar-strip.yml | 2/2 | 50.00% | formatter-error: a block_scalar |
| yaml/spec/comment-in-flow-sequence-before-comma.yml | 2/2 | 20.00% | formatter-error: a flow_sequence |
| yaml/spec/construct-binary.yml | 2/2 | 17.39% | formatter-error: a multi-line quoted scalar |
| yaml/spec/empty-lines-at-end-of-document.yml | 2/2 | 40.00% | formatter-error: a pair without a key |
| yaml/spec/flow-mapping-in-block-sequence.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/flow-mapping.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/flow-sequence-in-block-mapping.yml | 2/2 | 100.00% | formatter-error: a flow_sequence |
| yaml/spec/flow-sequence-in-flow-mapping.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/flow-sequence-in-flow-sequence.yml | 2/2 | 100.00% | formatter-error: a flow_sequence |
| yaml/spec/flow-sequence.yml | 2/2 | 100.00% | formatter-error: a flow_sequence |
| yaml/spec/folded-block-scalar.yml | 2/2 | 38.75% | formatter-error: a block_scalar |
| yaml/spec/implicit-flow-mapping-key-on-one-line.yml | 2/2 | 100.00% | formatter-error: a flow_sequence |
| yaml/spec/key-with-anchor-after-missing-explicit-mapping-value.yml | 2/2 | 75.00% | formatter-error: a pair without a key |
| yaml/spec/literal-block-scalar.yml | 2/2 | 42.86% | formatter-error: a block_scalar |
| yaml/spec/mapping-key-and-flow-sequence-item-anchors.yml | 2/2 | 66.67% | formatter-error: a flow_sequence |
| yaml/spec/mixed-block-mapping-explicit-to-implicit.yml | 2/2 | 40.00% | formatter-error: a pair without a key |
| yaml/spec/mixed-block-mapping-implicit-to-explicit.yml | 2/2 | 40.00% | formatter-error: a pair without a key |
| yaml/spec/multiline-plain-scalar-with-empty-line.yml | 2/2 | 52.22% | formatter-error: a multi-line plain scalar |
| yaml/spec/multiline-scalar-at-top-level.yml | 2/2 | 55.56% | formatter-error: a multi-line plain scalar |
| yaml/spec/multiline-scalar-in-mapping.yml | 2/2 | 22.22% | formatter-error: a multi-line plain scalar |
| yaml/spec/multiline-scalar-that-looks-like-a-yaml-directive.yml | 2/2 | 70.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/nested-flow-collections-on-one-line.yml | 2/2 | 50.00% | formatter-error: a flow_mapping |
| yaml/spec/nested-flow-collections.yml | 2/2 | 20.00% | formatter-error: a flow_mapping |
| yaml/spec/non-specific-tags-on-scalars.yml | 2/2 | 83.33% | formatter-error: a block_scalar |
| yaml/spec/plain-scalar-looking-like-key-comment-anchor-and-tag.yml | 2/2 | 25.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/plain-url-in-flow-mapping.yml | 2/2 | 100.00% | formatter-error: a flow_mapping |
| yaml/spec/scalars-on-line.yml | 2/2 | 12.50% | formatter-error: content on a marker line |
| yaml/spec/sequence-entry-that-looks-like-two-with-wrong-indentation.yml | 2/2 | 25.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-2-11-mapping-between-sequences.yml | 2/2 | 42.86% | formatter-error: a pair without a key |
| yaml/spec/spec-example-2-13-in-literals-newlines-are-preserved.yml | 2/2 | 66.67% | formatter-error: content on a marker line |
| yaml/spec/spec-example-2-14-in-the-folded-scalars-newlines-become-spaces.yml | 2/2 | 33.33% | formatter-error: content on a marker line |
| yaml/spec/spec-example-2-15-folded-newlines-are-preserved-for-more-indented-and-blank-lines.yml | 2/2 | 38.75% | formatter-error: a block_scalar |
| yaml/spec/spec-example-2-16-indentation-determines-scope.yml | 2/2 | 88.46% | formatter-error: a block_scalar |
| yaml/spec/spec-example-2-18-multi-line-flow-scalars.yml | 2/2 | 47.47% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-2-23-various-explicit-tags.yml | 2/2 | 46.15% | formatter-error: a block_scalar |
| yaml/spec/spec-example-2-24-global-tags.yml | 2/2 | 68.97% | formatter-error: content on a marker line |
| yaml/spec/spec-example-2-25-unordered-sets.yml | 2/2 | 80.00% | formatter-error: content on a marker line |
| yaml/spec/spec-example-2-26-ordered-mappings.yml | 2/2 | 80.00% | formatter-error: content on a marker line |
| yaml/spec/spec-example-2-27-invoice.yml | 2/2 | 17.55% | formatter-error: content on a marker line |
| yaml/spec/spec-example-2-28-log-file.yml | 2/2 | 79.11% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-2-5-sequence-of-sequences.yml | 2/2 | 33.33% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-2-6-mapping-of-mappings.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-5-12-tabs-and-spaces.yml | 2/2 | 83.33% | formatter-error: a block_scalar |
| yaml/spec/spec-example-5-3-block-structure-indicators.yml | 2/2 | 30.77% | formatter-error: a pair without a key |
| yaml/spec/spec-example-5-4-flow-collection-indicators.yml | 2/2 | 50.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-5-7-block-scalar-indicators.yml | 2/2 | 86.36% | formatter-error: a block_scalar |
| yaml/spec/spec-example-5-9-directive-indicator.yml | 2/2 | 40.00% | formatter-error: content on a marker line |
| yaml/spec/spec-example-6-1-indentation-spaces.yml | 2/2 | 24.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-10-comment-lines.yml | 2/2 | 0.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-11-multi-line-comments.yml | 2/2 | 25.00% | formatter-error: a comment before a scalar value |
| yaml/spec/spec-example-6-12-separation-spaces.yml | 2/2 | 33.33% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-6-13-reserved-directives.yml | 2/2 | 0.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-14-yaml-directive.yml | 2/2 | 75.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-2-indentation-indicators.yml | 2/2 | 0.00% | formatter-error: a pair without a key |
| yaml/spec/spec-example-6-4-line-prefixes.yml | 2/2 | 67.86% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-6-5-empty-lines.yml | 2/2 | 46.15% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-6-6-line-folding.yml | 2/2 | 58.79% | formatter-error: a block_scalar |
| yaml/spec/spec-example-6-7-block-folding.yml | 2/2 | 83.33% | formatter-error: a block_scalar |
| yaml/spec/spec-example-6-8-flow-folding.yml | 2/2 | 42.86% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-6-9-separated-comment.yml | 2/2 | 50.00% | formatter-error: a comment before a scalar value |
| yaml/spec/spec-example-7-10-plain-characters.yml | 2/2 | 70.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-11-plain-implicit-keys.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-12-plain-lines.yml | 2/2 | 53.57% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-7-13-flow-sequence.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-14-flow-sequence-entries.yml | 2/2 | 11.11% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-15-flow-mappings.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-7-16-flow-mapping-entries.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-7-17-flow-mapping-separate-values.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-7-18-flow-mapping-adjacent-values.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-7-19-single-pair-flow-mappings.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-2-empty-content.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-7-20-single-pair-explicit-entry.yml | 2/2 | 22.22% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-21-single-pair-implicit-entries.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-23-flow-content.yml | 2/2 | 60.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-24-flow-nodes.yml | 2/2 | 80.00% | formatter-error: properties without content |
| yaml/spec/spec-example-7-3-completely-empty-flow-nodes.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-7-4-double-quoted-implicit-keys.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-5-double-quoted-line-breaks.yml | 2/2 | 21.11% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-7-6-double-quoted-lines.yml | 2/2 | 53.57% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-7-8-single-quoted-implicit-keys.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/spec-example-7-9-single-quoted-lines.yml | 2/2 | 26.79% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-8-1-block-scalar-header.yml | 2/2 | 77.78% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-10-folded-lines-8-13-final-empty-lines.yml | 2/2 | 46.01% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-15-block-sequence-entry-types.yml | 2/2 | 66.67% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-17-explicit-block-mapping-entries.yml | 2/2 | 100.00% | formatter-error: a pair without a key |
| yaml/spec/spec-example-8-18-implicit-block-mapping-entries.yml | 2/2 | 75.00% | formatter-error: a pair without a key |
| yaml/spec/spec-example-8-19-compact-block-mappings.yml | 2/2 | 100.00% | formatter-error: a pair without a key |
| yaml/spec/spec-example-8-2-block-indentation-indicator.yml | 2/2 | 54.55% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-20-block-node-types.yml | 2/2 | 36.36% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-21-block-scalar-nodes.yml | 2/2 | 60.00% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-4-chomping-final-line-break.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-5-chomping-trailing-lines.yml | 2/2 | 47.37% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-8-6-empty-scalar-chomping.yml | 2/2 | 100.00% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-7-literal-scalar.yml | 2/2 | 25.00% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-8-literal-content.yml | 2/2 | 55.56% | formatter-error: a block_scalar |
| yaml/spec/spec-example-8-9-folded-scalar.yml | 2/2 | 26.79% | formatter-error: a block_scalar |
| yaml/spec/spec-example-9-3-bare-documents.yml | 2/2 | 73.63% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-9-4-explicit-documents.yml | 2/2 | 67.87% | formatter-error: a flow_mapping |
| yaml/spec/spec-example-9-5-directives-documents.yml | 2/2 | 70.59% | formatter-error: content on a marker line |
| yaml/spec/tab-after-document-header.yml | 2/2 | 0.00% | formatter-error: content on a marker line |
| yaml/spec/tab-at-beginning-of-line-followed-by-a-flow-mapping.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/tags-for-flow-objects.yml | 2/2 | 0.00% | formatter-error: a flow_mapping |
| yaml/spec/tags-for-root-objects.yml | 2/2 | 18.01% | formatter-error: content on a marker line |
| yaml/spec/tags-in-explicit-mapping.yml | 2/2 | 0.00% | formatter-error: a pair without a key |
| yaml/spec/tags-on-empty-scalars.yml | 2/2 | 66.67% | formatter-error: properties without content |
| yaml/spec/three-dashes-and-content-without-space.yml | 2/2 | 50.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/various-location-of-anchors-in-flow-sequence.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/various-trailing-comments.yml | 2/2 | 43.05% | formatter-error: a multi-line quoted scalar |
| yaml/spec/whitespace-after-scalars-in-flow.yml | 2/2 | 0.00% | formatter-error: a flow_sequence |
| yaml/spec/zero-indented-block-scalar-with-line-that-looks-like-a-comment.yml | 2/2 | 0.00% | formatter-error: content on a marker line |
| yaml/spec/zero-indented-block-scalar.yml | 2/2 | 0.00% | formatter-error: content on a marker line |

# Excluded

## oxfmt 0.70.0 rejects it: Syntax error: invalid block scalar indentation (1)

- yaml/_errors_/block-scalar-with-spaces-only.yml
