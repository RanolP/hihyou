yaml@oxfmt compatibility: 117/360 (32.50%), 15 refused (ok:false), 1 excluded

Fixtures: prettier 3.9.9 tests/format/{yaml} (recursive), every spec call listing parser `yaml`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| yaml/ansible/playbook.yml | 0/1 | 46.15% |
| yaml/block-folded/block-folded-keep.yml | 0/2 | 0.00% |
| yaml/block-folded/block-folded-strip.yml | 0/2 | 18.18% |
| yaml/block-folded/empty-line-after-block-scalar.yml | 1/2 | 86.36% |
| yaml/block-folded/map.yml | 1/2 | 83.33% |
| yaml/block-folded/middle-comments.yml | 0/2 | 66.67% |
| yaml/block-folded/newline-unaligned.yml | 1/2 | 77.78% |
| yaml/block-folded/newline.yml | 1/2 | 75.00% |
| yaml/block-folded/prose.yml | 0/2 | 52.63% |
| yaml/block-folded/seq.yml | 1/2 | 87.50% |
| yaml/block-literal/middle-comments.yml | 0/2 | 66.67% |
| yaml/comment/end-comment.yml | 0/1 | 69.23% |
| yaml/comment/map-2.yml | 0/1 | 86.49% |
| yaml/comment/map-4.yml | 0/1 | 92.31% |
| yaml/comment/object.yml | 0/1 | 85.71% |
| yaml/comment/sequence-2.yml | 0/1 | 92.31% |
| yaml/comment/sequence.yml | 0/1 | 46.15% |
| yaml/flow-mapping/alias-key.yml | 1/3 | 33.33% |
| yaml/flow-mapping/array-key-array-value.yml | 0/3 | 0.00% |
| yaml/flow-mapping/array-key.yml | 0/3 | 0.00% |
| yaml/flow-mapping/array-plain.yml | 0/3 | 0.00% |
| yaml/flow-mapping/array-value.yml | 0/3 | 0.00% |
| yaml/flow-mapping/comment-between.yml | 0/3 | 40.00% |
| yaml/flow-mapping/comment-trailing.yml | 0/3 | 40.00% |
| yaml/flow-mapping/empty-item-colon.yml | 2/3 | 66.67% |
| yaml/flow-mapping/empty-line-collapse.yml | 0/3 | 0.00% |
| yaml/flow-mapping/empty-line.yml | 0/3 | 25.00% |
| yaml/flow-mapping/long-key-long-value.yml | 0/3 | 0.00% |
| yaml/flow-mapping/long-key.yml | 0/3 | 0.00% |
| yaml/flow-mapping/long-plain.yml | 0/3 | 0.00% |
| yaml/flow-mapping/long-value.yml | 0/3 | 0.00% |
| yaml/flow-mapping/middle-comments.yml | 0/3 | 57.14% |
| yaml/flow-mapping/next-empty-line.yml | 0/3 | 54.55% |
| yaml/flow-mapping/props-in-map.yml | 1/3 | 33.33% |
| yaml/flow-mapping/props.yml | 1/3 | 33.33% |
| yaml/flow-mapping/short-key-short-value.yml | 0/3 | 0.00% |
| yaml/flow-mapping/short-key.yml | 0/3 | 0.00% |
| yaml/flow-mapping/short-plain.yml | 0/3 | 0.00% |
| yaml/flow-mapping/short-value.yml | 0/3 | 0.00% |
| yaml/flow-mapping/very-long-value.yml | 0/3 | 66.67% |
| yaml/flow-mapping/comments/key.yml | 0/1 | 25.00% |
| yaml/flow-mapping/trailing-comma/flow-mapping.yml | 0/4 | 74.24% |
| yaml/flow-sequence/array-key-array-value.yml | 0/3 | 0.00% |
| yaml/flow-sequence/array-key.yml | 0/3 | 0.00% |
| yaml/flow-sequence/array-plain.yml | 0/3 | 0.00% |
| yaml/flow-sequence/array-value.yml | 0/3 | 0.00% |
| yaml/flow-sequence/comment-between.yml | 0/3 | 40.00% |
| yaml/flow-sequence/comment-trailing.yml | 0/3 | 40.00% |
| yaml/flow-sequence/empty-item-colon.yml | 0/3 | 0.00% |
| yaml/flow-sequence/empty-line-collapse.yml | 0/3 | 0.00% |
| yaml/flow-sequence/empty-line.yml | 0/3 | 25.00% |
| yaml/flow-sequence/long-key-long-value.yml | 0/3 | 0.00% |
| yaml/flow-sequence/long-key.yml | 0/3 | 0.00% |
| yaml/flow-sequence/long-plain.yml | 0/3 | 0.00% |
| yaml/flow-sequence/long-value.yml | 0/3 | 0.00% |
| yaml/flow-sequence/middle-comments.yml | 0/3 | 57.14% |
| yaml/flow-sequence/next-empty-line.yml | 0/3 | 54.55% |
| yaml/flow-sequence/short-key-short-value.yml | 0/3 | 0.00% |
| yaml/flow-sequence/short-key.yml | 0/3 | 0.00% |
| yaml/flow-sequence/short-plain.yml | 0/3 | 0.00% |
| yaml/flow-sequence/short-value.yml | 0/3 | 0.00% |
| yaml/flow-sequence/trailing-comma/flow-sequence.yml | 0/4 | 62.86% |
| yaml/home-assistant/configuration.yml | 0/1 | 26.97% |
| yaml/inline-extend-syntax/inline-extend-syntax.yml | 0/1 | 50.00% |
| yaml/insert-pragma/with-pragma.yml | 0/1 | 66.67% |
| yaml/json/trailing-comma/json.yml | 0/4 | 50.00% |
| yaml/mapping/3-style.yml | 0/2 | 42.86% |
| yaml/mapping/anchor.yml | 0/2 | 72.73% |
| yaml/mapping/anchor2.yml | 0/2 | 50.00% |
| yaml/mapping/anchor3.yml | 0/2 | 54.55% |
| yaml/mapping/comment-value-align.yml | 1/2 | 75.00% |
| yaml/mapping/explicit-key.yml | 0/2 | 39.13% |
| yaml/mapping/mapping.yml | 1/2 | 75.00% |
| yaml/mapping/merge-twice.yml | 1/2 | 65.00% |
| yaml/mapping/middle-comments.yml | 0/2 | 57.14% |
| yaml/mapping/props-in-map.yml | 1/2 | 75.00% |
| yaml/mapping/props.yml | 0/2 | 40.00% |
| yaml/mapping/quote-key.yml | 0/2 | 50.00% |
| yaml/mapping/sequence.yml | 0/2 | 50.00% |
| yaml/mapping/tag-key.yml | 0/2 | 0.00% |
| yaml/mapping/duplicated-keys/flow-mapping.yml | 0/1 | 21.05% |
| yaml/mapping/duplicated-keys/mapping.yml | 0/1 | 72.73% |
| yaml/mapping/duplicated-keys/template-expression.yml | 0/1 | 20.00% |
| yaml/mapping/long-key/test.yml | 1/2 | 50.00% |
| yaml/plain/force-singleline-in-mapping-value.yml | 1/3 | 84.59% |
| yaml/plain/middle-comments.yml | 0/3 | 57.14% |
| yaml/plain/multiline.yml | 0/3 | 0.00% |
| yaml/prettier-ignore/document.yml | 0/1 | 76.92% |
| yaml/prettier-ignore/leading-comment.yml | 0/1 | 66.67% |
| yaml/prettier-ignore/middle-comment.yml | 0/1 | 60.00% |
| yaml/prettier-ignore/trailing-comma.yml | 0/1 | 44.44% |
| yaml/prettier-ignore/trailing-comment.yml | 0/1 | 66.67% |
| yaml/quote/multiline.yml | 0/4 | 0.00% |
| yaml/quote/quote.yml | 0/4 | 55.56% |
| yaml/require-pragma/with-pragma.yml | 0/1 | 66.67% |
| yaml/root/empty.yml | 0/1 | 0.00% |
| yaml/root/example.yml | 0/1 | 82.61% |
| yaml/sequence/middle-comments.yml | 0/2 | 57.14% |
| yaml/sequence/props-in-map.yml | 0/2 | 33.33% |
| yaml/sequence/props.yml | 0/2 | 57.14% |
| yaml/spec/aliases-in-explicit-block-mapping.yml | 0/2 | 40.00% |
| yaml/spec/allowed-characters-in-plain-scalars.yml | 0/2 | 70.00% |
| yaml/spec/anchor-before-zero-indented-sequence.yml | 0/2 | 22.22% |
| yaml/spec/anchors-with-colon-in-name.yml | 0/2 | 40.00% |
| yaml/spec/blank-lines.yml | 0/2 | 83.33% |
| yaml/spec/block-mapping-with-missing-values.yml | 0/2 | 33.33% |
| yaml/spec/block-mapping-with-multiline-scalars.yml | 1/2 | 50.00% |
| yaml/spec/block-scalar-indicator-order.yml | 0/2 | 75.00% |
| yaml/spec/block-scalar-keep.yml | 0/2 | 0.00% |
| yaml/spec/block-scalar-strip.yml | 0/2 | 50.00% |
| yaml/spec/block-sequence-in-block-mapping.yml | 0/2 | 33.33% |
| yaml/spec/colon-in-double-quoted-string.yml | 0/2 | 0.00% |
| yaml/spec/comment-in-flow-sequence-before-comma.yml | 0/2 | 20.00% |
| yaml/spec/construct-binary.yml | 0/2 | 17.39% |
| yaml/spec/empty-lines-between-mapping-elements.yml | 0/2 | 85.71% |
| yaml/spec/empty-stream.yml | 0/2 | 0.00% |
| yaml/spec/flow-mapping-in-block-sequence.yml | 0/2 | 0.00% |
| yaml/spec/flow-mapping.yml | 0/2 | 0.00% |
| yaml/spec/flow-sequence-in-flow-mapping.yml | 0/2 | 0.00% |
| yaml/spec/folded-block-scalar.yml | 0/2 | 38.75% |
| yaml/spec/key-with-anchor-after-missing-explicit-mapping-value.yml | 0/2 | 75.00% |
| yaml/spec/literal-block-scalar.yml | 0/2 | 42.86% |
| yaml/spec/mapping-key-and-flow-sequence-item-anchors.yml | 0/2 | 66.67% |
| yaml/spec/mixed-block-mapping-explicit-to-implicit.yml | 0/2 | 40.00% |
| yaml/spec/mixed-block-mapping-implicit-to-explicit.yml | 0/2 | 40.00% |
| yaml/spec/multiline-plain-scalar-with-empty-line.yml | 0/2 | 52.22% |
| yaml/spec/multiline-scalar-at-top-level.yml | 0/2 | 55.56% |
| yaml/spec/multiline-scalar-in-mapping.yml | 0/2 | 22.22% |
| yaml/spec/multiline-scalar-that-looks-like-a-yaml-directive.yml | 1/2 | 70.00% |
| yaml/spec/nested-flow-collections-on-one-line.yml | 0/2 | 50.00% |
| yaml/spec/nested-flow-collections.yml | 0/2 | 20.00% |
| yaml/spec/node-anchor-and-tag-on-seperate-lines.yml | 0/2 | 40.00% |
| yaml/spec/node-and-mapping-key-anchors.yml | 0/2 | 60.00% |
| yaml/spec/non-specific-tags-on-scalars.yml | 0/2 | 83.33% |
| yaml/spec/plain-scalar-looking-like-key-comment-anchor-and-tag.yml | 0/2 | 25.00% |
| yaml/spec/scalars-on-line.yml | 0/2 | 12.50% |
| yaml/spec/sequence-entry-that-looks-like-two-with-wrong-indentation.yml | 0/2 | 25.00% |
| yaml/spec/sequence-indent.yml | 0/2 | 75.00% |
| yaml/spec/sequence-with-same-indentation-as-parent-mapping.yml | 0/2 | 50.00% |
| yaml/spec/spec-example-2-11-mapping-between-sequences.yml | 0/2 | 42.86% |
| yaml/spec/spec-example-2-12-compact-nested-mapping.yml | 0/2 | 62.50% |
| yaml/spec/spec-example-2-13-in-literals-newlines-are-preserved.yml | 0/2 | 66.67% |
| yaml/spec/spec-example-2-14-in-the-folded-scalars-newlines-become-spaces.yml | 0/2 | 33.33% |
| yaml/spec/spec-example-2-15-folded-newlines-are-preserved-for-more-indented-and-blank-lines.yml | 0/2 | 38.75% |
| yaml/spec/spec-example-2-16-indentation-determines-scope.yml | 1/2 | 88.46% |
| yaml/spec/spec-example-2-17-quoted-scalars.yml | 0/2 | 85.71% |
| yaml/spec/spec-example-2-18-multi-line-flow-scalars.yml | 0/2 | 47.47% |
| yaml/spec/spec-example-2-2-mapping-scalars-to-scalars.yml | 0/2 | 33.33% |
| yaml/spec/spec-example-2-23-various-explicit-tags.yml | 0/2 | 46.15% |
| yaml/spec/spec-example-2-24-global-tags.yml | 0/2 | 68.97% |
| yaml/spec/spec-example-2-25-unordered-sets.yml | 0/2 | 80.00% |
| yaml/spec/spec-example-2-26-ordered-mappings.yml | 0/2 | 80.00% |
| yaml/spec/spec-example-2-27-invoice.yml | 0/2 | 17.55% |
| yaml/spec/spec-example-2-28-log-file.yml | 0/2 | 79.11% |
| yaml/spec/spec-example-2-4-sequence-of-mappings.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-2-5-sequence-of-sequences.yml | 0/2 | 33.33% |
| yaml/spec/spec-example-2-6-mapping-of-mappings.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-5-12-tabs-and-spaces.yml | 0/2 | 83.33% |
| yaml/spec/spec-example-5-3-block-structure-indicators.yml | 0/2 | 30.77% |
| yaml/spec/spec-example-5-4-flow-collection-indicators.yml | 0/2 | 50.00% |
| yaml/spec/spec-example-5-7-block-scalar-indicators.yml | 1/2 | 86.36% |
| yaml/spec/spec-example-5-8-quoted-scalar-indicators.yml | 0/2 | 50.00% |
| yaml/spec/spec-example-5-9-directive-indicator.yml | 0/2 | 40.00% |
| yaml/spec/spec-example-6-1-indentation-spaces.yml | 0/2 | 32.00% |
| yaml/spec/spec-example-6-11-multi-line-comments.yml | 0/2 | 33.33% |
| yaml/spec/spec-example-6-12-separation-spaces.yml | 0/2 | 33.33% |
| yaml/spec/spec-example-6-13-reserved-directives.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-6-14-yaml-directive.yml | 0/2 | 75.00% |
| yaml/spec/spec-example-6-2-indentation-indicators.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-6-23-node-properties.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-6-24-verbatim-tags.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-6-3-separation-spaces.yml | 0/2 | 33.33% |
| yaml/spec/spec-example-6-4-line-prefixes.yml | 0/2 | 67.86% |
| yaml/spec/spec-example-6-6-line-folding.yml | 0/2 | 58.79% |
| yaml/spec/spec-example-6-7-block-folding.yml | 0/2 | 83.33% |
| yaml/spec/spec-example-6-8-flow-folding.yml | 0/2 | 42.86% |
| yaml/spec/spec-example-6-9-separated-comment.yml | 0/2 | 50.00% |
| yaml/spec/spec-example-7-10-plain-characters.yml | 0/2 | 70.00% |
| yaml/spec/spec-example-7-11-plain-implicit-keys.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-12-plain-lines.yml | 0/2 | 53.57% |
| yaml/spec/spec-example-7-13-flow-sequence.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-14-flow-sequence-entries.yml | 0/2 | 11.11% |
| yaml/spec/spec-example-7-15-flow-mappings.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-16-flow-mapping-entries.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-17-flow-mapping-separate-values.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-18-flow-mapping-adjacent-values.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-19-single-pair-flow-mappings.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-2-empty-content.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-20-single-pair-explicit-entry.yml | 0/2 | 22.22% |
| yaml/spec/spec-example-7-21-single-pair-implicit-entries.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-23-flow-content.yml | 0/2 | 60.00% |
| yaml/spec/spec-example-7-24-flow-nodes.yml | 0/2 | 80.00% |
| yaml/spec/spec-example-7-3-completely-empty-flow-nodes.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-4-double-quoted-implicit-keys.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-5-double-quoted-line-breaks.yml | 0/2 | 21.11% |
| yaml/spec/spec-example-7-6-double-quoted-lines.yml | 0/2 | 53.57% |
| yaml/spec/spec-example-7-8-single-quoted-implicit-keys.yml | 0/2 | 0.00% |
| yaml/spec/spec-example-7-9-single-quoted-lines.yml | 0/2 | 26.79% |
| yaml/spec/spec-example-8-1-block-scalar-header.yml | 0/2 | 77.78% |
| yaml/spec/spec-example-8-10-folded-lines-8-13-final-empty-lines.yml | 0/2 | 46.01% |
| yaml/spec/spec-example-8-14-block-sequence.yml | 0/2 | 66.67% |
| yaml/spec/spec-example-8-15-block-sequence-entry-types.yml | 0/2 | 66.67% |
| yaml/spec/spec-example-8-16-block-mappings.yml | 0/2 | 50.00% |
| yaml/spec/spec-example-8-18-implicit-block-mapping-entries.yml | 0/2 | 75.00% |
| yaml/spec/spec-example-8-2-block-indentation-indicator.yml | 0/2 | 54.55% |
| yaml/spec/spec-example-8-20-block-node-types.yml | 0/2 | 36.36% |
| yaml/spec/spec-example-8-21-block-scalar-nodes.yml | 0/2 | 60.00% |
| yaml/spec/spec-example-8-22-block-collection-nodes.yml | 0/2 | 33.33% |
| yaml/spec/spec-example-8-5-chomping-trailing-lines.yml | 0/2 | 52.63% |
| yaml/spec/spec-example-8-6-empty-scalar-chomping.yml | 0/2 | 90.91% |
| yaml/spec/spec-example-8-8-literal-content.yml | 0/2 | 55.56% |
| yaml/spec/spec-example-9-3-bare-documents.yml | 0/2 | 73.63% |
| yaml/spec/spec-example-9-4-explicit-documents.yml | 0/2 | 67.87% |
| yaml/spec/spec-example-9-5-directives-documents.yml | 0/2 | 70.59% |
| yaml/spec/tab-after-document-header.yml | 0/2 | 0.00% |
| yaml/spec/tags-for-flow-objects.yml | 0/2 | 0.00% |
| yaml/spec/tags-for-root-objects.yml | 0/2 | 18.01% |
| yaml/spec/tags-in-explicit-mapping.yml | 0/2 | 0.00% |
| yaml/spec/tags-on-empty-scalars.yml | 0/2 | 66.67% |
| yaml/spec/three-dashes-and-content-without-space.yml | 1/2 | 50.00% |
| yaml/spec/various-combinations-of-tags-and-anchors.yml | 0/2 | 69.57% |
| yaml/spec/various-location-of-anchors-in-flow-sequence.yml | 0/2 | 0.00% |
| yaml/spec/various-trailing-comments.yml | 0/2 | 43.05% |
| yaml/spec/various-trailing-tabs.yml | 0/2 | 0.00% |
| yaml/spec/whitespace-after-scalars-in-flow.yml | 0/2 | 0.00% |
| yaml/spec/whitespace-around-colon-in-mappings.yml | 0/2 | 17.39% |
| yaml/spec/zero-indented-block-scalar-with-line-that-looks-like-a-comment.yml | 0/2 | 0.00% |
| yaml/spec/zero-indented-block-scalar.yml | 0/2 | 0.00% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| yaml/block-folded/clip.yml | 2/2 | 29.17% | check: input ">\n    123\n    456\n    789\n\n\n" at 0 is output as ">\n    123\n    456\n    789\n" at 0, which means " |
| yaml/block-folded/indent.yml | 2/2 | 100.00% | check: input ">2-\n    123\n   456\n  789\n\n\n" at 0 is output as ">2-\n    123\n   456\n  789\n" at 0, which means ">2 |
| yaml/block-folded/keep.yml | 2/2 | 22.50% | check: input ">+\n    123\n    456\n    789\n\n\n" at 0 is output as ">+\n    123\n    456\n    789\n" at 0, which means |
| yaml/block-folded/strip.yml | 2/2 | 29.17% | check: input ">-\n    123\n    456\n    789\n\n\n" at 0 is output as ">-\n    123\n    456\n    789\n" at 0, which means |
| yaml/block-literal/clip.yml | 2/2 | 25.00% | check: input "\|\n    123\n    456\n    789\n\n\n" at 0 is output as "\|\n    123\n    456\n    789\n" at 0, which means " |
| yaml/block-literal/indent.yml | 2/2 | 100.00% | check: input "\|2-\n    123\n   456\n  789\n\n\n" at 0 is output as "\|2-\n    123\n   456\n  789\n" at 0, which means "\|2 |
| yaml/block-literal/keep.yml | 2/2 | 20.00% | check: input "\|+\n    123\n    456\n    789\n\n\n" at 0 is output as "\|+\n    123\n    456\n    789\n" at 0, which means |
| yaml/block-literal/strip.yml | 2/2 | 25.00% | check: input "\|-\n    123\n    456\n    789\n\n\n" at 0 is output as "\|-\n    123\n    456\n    789\n" at 0, which means |
| yaml/comment/flow-sequence-mapping.yml | 1/1 | 39.39% | check: the output has a syntax error at 132, which the input has not |
| yaml/spec/anchors-and-tags.yml | 2/2 | 25.00% | check: input "a" at 12 is output as "a\n - !!int 2\n - !!int &c 4\n - &d d" at 11, which means "a\n - !!int 2\n - !!int  |
| yaml/spec/block-mappings-in-block-sequence.yml | 2/2 | 28.57% | check: the output has a syntax error at 0, which the input has not |
| yaml/spec/spec-example-6-5-empty-lines.yml | 2/2 | 54.55% | check: input "\|\n  Clipped empty lines\n \n\n" at 56 is output as "\|\n  Clipped empty lines\n" at 56, which means "\|\n   |
| yaml/spec/spec-example-8-7-literal-scalar.yml | 2/2 | 33.33% | check: input "\|\n literal\n \ttext\n\n\n" at 0 is output as "\|\n literal\n \ttext\n" at 0, which means "\|\n literal\n \t |
| yaml/spec/spec-example-8-9-folded-scalar.yml | 2/2 | 36.67% | check: input ">\n folded\n text\n\n\n" at 0 is output as ">\n folded\n text\n" at 0, which means ">\n folded\n text\n",  |
| yaml/spec/tags-in-block-sequence.yml | 2/2 | 25.00% | check: input "a" at 9 is output as "a\n - b\n - !!int 42\n - d" at 8, which means "a\n - b\n - !!int 42\n - d", not "a" |

# Excluded

## oxfmt 0.70.0 rejects it: Syntax error: invalid block scalar indentation (1)

- yaml/_errors_/block-scalar-with-spaces-only.yml
