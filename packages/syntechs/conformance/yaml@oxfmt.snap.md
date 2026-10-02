yaml@oxfmt compatibility: 269/360 (74.72%), 91 refused (ok:false), 1 excluded

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
| yaml/block-folded/middle-comment.yml | 2/2 | 100.00% | formatter-error: a comment after properties |
| yaml/block-folded/middle-comments.yml | 2/2 | 66.67% | formatter-error: a comment after properties |
| yaml/block-literal/middle-comment.yml | 2/2 | 100.00% | formatter-error: a comment after properties |
| yaml/block-literal/middle-comments.yml | 2/2 | 66.67% | formatter-error: a comment after properties |
| yaml/comment/collection.yml | 1/1 | 100.00% | formatter-error: a comment before a scalar value |
| yaml/comment/end-comment.yml | 1/1 | 69.23% | formatter-error: a comment between a nested block and its parent |
| yaml/comment/flow-sequence-mapping.yml | 1/1 | 39.39% | formatter-error: a prettier-ignore comment |
| yaml/document/with-document-head-like.yml | 1/1 | 100.00% | formatter-error: a multi-line plain scalar |
| yaml/flow-mapping/array-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-mapping/comment-between.yml | 3/3 | 40.00% | formatter-error: a comment inside a flow collection |
| yaml/flow-mapping/comment-trailing.yml | 3/3 | 40.00% | formatter-error: a comment inside a flow collection |
| yaml/flow-mapping/long-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-mapping/middle-comment.yml | 3/3 | 100.00% | formatter-error: a comment inside a flow collection |
| yaml/flow-mapping/middle-comments.yml | 3/3 | 57.14% | formatter-error: a comment inside a flow collection |
| yaml/flow-mapping/short-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-mapping/comments/key.yml | 1/1 | 25.00% | formatter-error: a comment inside a flow collection |
| yaml/flow-mapping/trailing-comma/flow-mapping.yml | 4/4 | 74.24% | formatter-error: a token not found in the stream text |
| yaml/flow-sequence/array-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-sequence/array-value.yml | 3/3 | 0.00% | formatter-error: a flow collection after an empty key |
| yaml/flow-sequence/comment-between.yml | 3/3 | 40.00% | formatter-error: a comment inside a flow collection |
| yaml/flow-sequence/comment-trailing.yml | 3/3 | 40.00% | formatter-error: a comment inside a flow collection |
| yaml/flow-sequence/long-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-sequence/middle-comment.yml | 3/3 | 100.00% | formatter-error: a comment inside a flow collection |
| yaml/flow-sequence/middle-comments.yml | 3/3 | 57.14% | formatter-error: a comment inside a flow collection |
| yaml/flow-sequence/short-key.yml | 3/3 | 0.00% | formatter-error: a stream that does not parse |
| yaml/flow-sequence/trailing-comma/flow-sequence.yml | 4/4 | 62.86% | formatter-error: a token not found in the stream text |
| yaml/mapping/explicit-key.yml | 2/2 | 39.13% | formatter-error: a multi-line plain scalar |
| yaml/mapping/middle-comment.yml | 2/2 | 100.00% | formatter-error: a comment after root properties |
| yaml/mapping/middle-comments.yml | 2/2 | 57.14% | formatter-error: a comment after root properties |
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
| yaml/root/example.yml | 1/1 | 82.61% | formatter-error: a comment inside a flow collection |
| yaml/sequence/middle-comment.yml | 2/2 | 100.00% | formatter-error: a comment after root properties |
| yaml/sequence/middle-comments.yml | 2/2 | 57.14% | formatter-error: a comment after root properties |
| yaml/spec/allowed-characters-in-plain-scalars.yml | 2/2 | 70.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/block-mapping-with-multiline-scalars.yml | 2/2 | 50.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/block-scalar-keep.yml | 2/2 | 0.00% | formatter-error: a comment after a kept block scalar ending the stream |
| yaml/spec/comment-in-flow-sequence-before-comma.yml | 2/2 | 20.00% | formatter-error: a comment inside a flow collection |
| yaml/spec/construct-binary.yml | 2/2 | 17.39% | formatter-error: a multi-line quoted scalar |
| yaml/spec/multiline-plain-scalar-with-empty-line.yml | 2/2 | 52.22% | formatter-error: a multi-line plain scalar |
| yaml/spec/multiline-scalar-at-top-level.yml | 2/2 | 55.56% | formatter-error: a multi-line plain scalar |
| yaml/spec/multiline-scalar-in-mapping.yml | 2/2 | 22.22% | formatter-error: a multi-line plain scalar |
| yaml/spec/multiline-scalar-that-looks-like-a-yaml-directive.yml | 2/2 | 70.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/non-specific-tags-on-scalars.yml | 2/2 | 83.33% | formatter-error: a token not found in the stream text |
| yaml/spec/plain-scalar-looking-like-key-comment-anchor-and-tag.yml | 2/2 | 25.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/scalars-on-line.yml | 2/2 | 12.50% | formatter-error: a multi-line quoted scalar |
| yaml/spec/sequence-entry-that-looks-like-two-with-wrong-indentation.yml | 2/2 | 25.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-2-18-multi-line-flow-scalars.yml | 2/2 | 47.47% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-2-24-global-tags.yml | 2/2 | 68.97% | formatter-error: a comment after root properties |
| yaml/spec/spec-example-2-27-invoice.yml | 2/2 | 17.55% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-2-28-log-file.yml | 2/2 | 79.11% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-5-12-tabs-and-spaces.yml | 2/2 | 83.33% | formatter-error: a token not found in the stream text |
| yaml/spec/spec-example-6-1-indentation-spaces.yml | 2/2 | 24.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-10-comment-lines.yml | 2/2 | 0.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-11-multi-line-comments.yml | 2/2 | 25.00% | formatter-error: a comment before a scalar value |
| yaml/spec/spec-example-6-12-separation-spaces.yml | 2/2 | 33.33% | formatter-error: a comment before a scalar value |
| yaml/spec/spec-example-6-13-reserved-directives.yml | 2/2 | 0.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-14-yaml-directive.yml | 2/2 | 75.00% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-6-4-line-prefixes.yml | 2/2 | 67.86% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-6-5-empty-lines.yml | 2/2 | 46.15% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-6-8-flow-folding.yml | 2/2 | 42.86% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-6-9-separated-comment.yml | 2/2 | 50.00% | formatter-error: a comment before a scalar value |
| yaml/spec/spec-example-7-12-plain-lines.yml | 2/2 | 53.57% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-7-14-flow-sequence-entries.yml | 2/2 | 11.11% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-7-2-empty-content.yml | 2/2 | 0.00% | formatter-error: properties without content |
| yaml/spec/spec-example-7-20-single-pair-explicit-entry.yml | 2/2 | 22.22% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-7-24-flow-nodes.yml | 2/2 | 80.00% | formatter-error: properties without content |
| yaml/spec/spec-example-7-5-double-quoted-line-breaks.yml | 2/2 | 21.11% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-7-6-double-quoted-lines.yml | 2/2 | 53.57% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-7-9-single-quoted-lines.yml | 2/2 | 26.79% | formatter-error: a multi-line quoted scalar |
| yaml/spec/spec-example-8-20-block-node-types.yml | 2/2 | 36.36% | formatter-error: a token not found in the stream text |
| yaml/spec/spec-example-8-5-chomping-trailing-lines.yml | 2/2 | 47.37% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-8-8-literal-content.yml | 2/2 | 55.56% | formatter-error: an indented comment outside a collection |
| yaml/spec/spec-example-9-3-bare-documents.yml | 2/2 | 73.63% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-9-4-explicit-documents.yml | 2/2 | 67.87% | formatter-error: a multi-line plain scalar |
| yaml/spec/spec-example-9-5-directives-documents.yml | 2/2 | 70.59% | formatter-error: a token not found in the stream text |
| yaml/spec/tags-for-root-objects.yml | 2/2 | 18.01% | formatter-error: a multi-line plain scalar |
| yaml/spec/tags-on-empty-scalars.yml | 2/2 | 66.67% | formatter-error: properties without content |
| yaml/spec/three-dashes-and-content-without-space.yml | 2/2 | 50.00% | formatter-error: a multi-line plain scalar |
| yaml/spec/various-trailing-comments.yml | 2/2 | 43.05% | formatter-error: a multi-line quoted scalar |

# Excluded

## oxfmt 0.70.0 rejects it: Syntax error: invalid block scalar indentation (1)

- yaml/_errors_/block-scalar-with-spaces-only.yml
