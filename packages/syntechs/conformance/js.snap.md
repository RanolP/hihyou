js compatibility: 762/804 (94.78%), 9 refused (ok:false), 304 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 563/804 (70.02%)

Fixtures: prettier 3.9.9 tests/format/{js,jsx} (recursive), every spec call listing parser `babel` or `acorn` or `espree` or `meriyah` or `oxc`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| js/arrays/numbers-with-holes.js | 0/1 | 57.78% |
| js/arrays/preserve_empty_lines.js | 0/1 | 90.00% |
| js/arrows/arrow_function_expression.js | 0/2 | 94.29% |
| js/arrows/issue-17421.js | 0/2 | 87.02% |
| js/arrows/parenthesized-body/issue-18776.js | 0/1 | 85.71% |
| js/classes/multiple-static.js | 0/1 | 40.00% |
| js/comments/blank.js | 0/2 | 92.31% |
| js/comments/export.js | 0/2 | 94.81% |
| js/comments/function-declaration.js | 0/2 | 80.95% |
| js/comments/jsdoc-nestled-dangling.js | 0/2 | 93.02% |
| js/comments/jsdoc-nestled.js | 0/2 | 89.29% |
| js/comments/return-statement.js | 0/2 | 98.34% |
| js/comments/tagged-template-literal.js | 0/2 | 92.86% |
| js/comments/variable-declarator.js | 0/2 | 95.10% |
| js/comments/in-list/dangling-comment-in-list.js | 0/1 | 95.95% |
| js/comments/tagged-template-literal/11662.js | 0/1 | 80.00% |
| js/comments/while-like/switch.js | 0/1 | 86.67% |
| js/embeded/indention/19518.js | 0/1 | 64.94% |
| js/embeded/indention/indention-2.js | 0/1 | 23.53% |
| js/embeded/indention/indention.js | 0/1 | 63.27% |
| js/empty-paren-comment/empty_paren_comment.js | 0/1 | 91.43% |
| js/export/blank-line-between-specifiers.js | 0/2 | 95.00% |
| js/for/for-in-with-initializer.js | 0/1 | 38.71% |
| js/if/condition-break/boolean-expression.js | 0/1 | 97.01% |
| js/import-attributes/long-sources.js | 0/1 | 86.54% |
| js/import-attributes/quote-props/quoted-keys.js | 1/3 | 86.67% |
| js/newline/backslash_2028.js | 0/1 | 40.00% |
| js/newline/backslash_2029.js | 0/1 | 40.00% |
| js/reserved-word/yield.js | 0/1 | 93.33% |
| js/sequence-break/break.js | 0/1 | 85.29% |
| js/sequence-expression/ignore.js | 0/1 | 72.73% |
| js/sequence-expression/parenthesized.js | 0/1 | 85.71% |
| js/template-literals/expression-break.js | 0/1 | 80.00% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| js/comments/break-continue-statements-3.js | 2/2 | 95.83% | check: output comment "// breaking comment;" matches no input comment |
| js/comments/trailing_space.js | 2/2 | 100.00% | check: input "#!/there/is-space-here->         " at 0 is output as "#!/there/is-space-here->" at 0, which means "#!/ther |
| js/decorators/comments.js | 1/1 | 93.94% | check: output comment "// B export // C" matches no input comment |
| js/decorators-export/after_export.js | 1/1 | 76.92% | check: input "export" at 0 is output as "export" at 0, which means "export@\|0/2", not "export@\|-1/2" |
| js/directives/issue-7346.js | 1/1 | 100.00% | check: input "'bar'" at 78 is output as "\"bar\"" at 79, which means "str:bar@\|0/7", not "str:bar@\|0/6" |
| js/for-of/comments.js | 1/1 | 100.00% | check: output comment "//2b //2c" matches no input comment |
| js/import/empty-import/empty-import.js | 1/1 | 64.86% | check: output comment "// comment } from \"a\";" matches no input comment |
| js/quotes/strings.js | 2/2 | 100.00% | check: input "\"abc\"" at 497 is output as "\"abc\"" at 498, which means "str:abc@\|0/4", not "str:abc@\|0/3" |
| jsx/comments/in-end-tag.js | 1/1 | 32.08% | check: input ">" at 503 is output as ">" at 503, which means ">@\|-1/71", not ">@\|-1/62" |

# Excluded

## cursor or range formatting (50)

- js/cursor/require-pragma/cursor-without-pragma.js
- js/eol/cursor-1.js
- js/eol/cursor-and-range.js
- js/eol/range-1.js
- js/eol/range-and-cursor-1.js
- js/new-target/range.js
- js/range/array.js
- js/range/boundary-2.js
- js/range/boundary-3.js
- js/range/boundary.js
- js/range/class-declaration.js
- js/range/different-levels.js
- js/range/directive.js
- js/range/function-body.js
- js/range/function-declaration.js
- js/range/ignore-indentation.js
- js/range/issue-12540.js
- js/range/issue-3789-1.js
- js/range/issue-3789-2.js
- js/range/issue-4206-1.js
- js/range/issue-4206-2.js
- js/range/issue-4206-3.js
- js/range/issue-4206-4.js
- js/range/issue-7082.js
- js/range/large-dict.js
- js/range/module-export1.js
- js/range/module-export2.js
- js/range/module-export3.js
- js/range/module-import.js
- js/range/multiple-statements.js
- js/range/multiple-statements2.js
- js/range/nested-print-width.js
- js/range/nested.js
- js/range/nested2.js
- js/range/nested3.js
- js/range/object-expression.js
- js/range/object-expression2.js
- js/range/range-end.js
- js/range/range-start.js
- js/range/range.js
- js/range/reversed-range.js
- js/range/start-equals-end.js
- js/range/try-catch.js
- js/range/whitespace.js
- jsx/cursor/after-last-jsx-text.js
- jsx/cursor/after-tag.js
- jsx/cursor/before-first-jsx-text.js
- jsx/cursor/before-tag.js
- jsx/cursor/in-jsx-text.js
- jsx/cursor/in-tag.js

## ignored syntax (not in the grammar or not the parser's) (176)

- js/arrows-bind/arrows-bind.js
- js/async-do-expressions/async-do-expressions.js
- js/await/like-call.js
- js/babel-plugins/async-do-expressions.js
- js/babel-plugins/async-generators.js
- js/babel-plugins/bigint.js
- js/babel-plugins/class-properties.js
- js/babel-plugins/class-static-block.js
- js/babel-plugins/decorator-auto-accessors.js
- js/babel-plugins/decorators.js
- js/babel-plugins/deferred-import-evaluation.js
- js/babel-plugins/destructuring-private.js
- js/babel-plugins/discard-binding.js
- js/babel-plugins/do-expressions.js
- js/babel-plugins/dynamic-import.js
- js/babel-plugins/explicit-resource-management.js
- js/babel-plugins/export-default-from.js
- js/babel-plugins/export-namespace-from.js
- js/babel-plugins/flow.js
- js/babel-plugins/function-bind.js
- js/babel-plugins/function-sent.js
- js/babel-plugins/import-assertions-dynamic.js
- js/babel-plugins/import-attributes-dynamic.js
- js/babel-plugins/import-attributes-static.js
- js/babel-plugins/import-meta.js
- js/babel-plugins/jsx.js
- js/babel-plugins/logical-assignment-operators.js
- js/babel-plugins/module-blocks.js
- js/babel-plugins/module-string-names.js
- js/babel-plugins/nullish-coalescing-operator.js
- js/babel-plugins/numeric-separator.js
- js/babel-plugins/object-rest-spread.js
- js/babel-plugins/optional-catch-binding.js
- js/babel-plugins/optional-chaining-assignment.js
- js/babel-plugins/optional-chaining.js
- js/babel-plugins/partial-application.js
- js/babel-plugins/pipeline-operator-fsharp.js
- js/babel-plugins/pipeline-operator-hack.cjs
- js/babel-plugins/pipeline-operator-minimal.js
- js/babel-plugins/private-fields-in-in.js
- js/babel-plugins/private-methods.js
- js/babel-plugins/regex-v-flag.js
- js/babel-plugins/regexp-modifiers.js
- js/babel-plugins/source-phase-imports.js
- js/babel-plugins/throw-expressions.js
- js/babel-plugins/typescript.js
- js/babel-plugins/v8intrinsic.js
- js/bind-expressions/await.js
- js/bind-expressions/bind_parens.js
- js/bind-expressions/long_name_method.js
- js/bind-expressions/method_chain.js
- js/bind-expressions/short_name_method.js
- js/bind-expressions/unary.js
- js/call/invalid/null-arguments-item.js
- js/comments-closure-typecast/styled-components.js
- js/comments-pipeline-own-line/pipeline_own_line.js
- js/deferred-import-evaluation/dynamic-import-attributes-expression.js
- js/deferred-import-evaluation/dynamic-import.js
- js/deferred-import-evaluation/import-defer-attributes-declaration.js
- js/deferred-import-evaluation/import-defer.js
- js/destructuring-private-fields/arrow-params.js
- js/destructuring-private-fields/assignment.js
- js/destructuring-private-fields/async-arrow-params.js
- js/destructuring-private-fields/bindings.js
- js/destructuring-private-fields/for-lhs.js
- js/destructuring-private-fields/nested-bindings.js
- js/destructuring-private-fields/valid-multiple-bindings.js
- js/do/call-arguments.js
- js/do/do.js
- js/export-default/escaped/default-escaped.js
- js/export-default/export-default-from/export.js
- js/ignore/decorator.js
- js/ignore/ignore.js
- js/ignore/issue-10661.js
- js/ignore/issue-11077.js
- js/ignore/issue-13737.js
- js/ignore/issue-14404.js
- js/ignore/issue-18303.js
- js/ignore/issue-9335.js
- js/ignore/issue-9877.js
- js/ignore/parenthesized-expression.js
- js/ignore/semi/asi.js
- js/ignore/semi/class-expression-decorator.js
- js/ignore/semi/directive.js
- js/ignore/semi/head-ignored.js
- js/last-argument-expansion/embed.js
- js/module-blocks/comments.js
- js/module-blocks/module-blocks.js
- js/module-blocks/non-module-blocks.js
- js/module-blocks/range.js
- js/module-blocks/quote-props/worker.js
- js/multiparser-comments/comment-inside.js
- js/multiparser-comments/comments.js
- js/multiparser-comments/tagged.js
- js/multiparser-css/colons-after-substitutions.js
- js/multiparser-css/colons-after-substitutions2.js
- js/multiparser-css/issue-11400.js
- js/multiparser-css/issue-11797.js
- js/multiparser-css/issue-16692.js
- js/multiparser-css/issue-2636.js
- js/multiparser-css/issue-2883.js
- js/multiparser-css/issue-5697.js
- js/multiparser-css/issue-5961.js
- js/multiparser-css/issue-6259.js
- js/multiparser-css/issue-8352.js
- js/multiparser-css/issue-9072.js
- js/multiparser-css/styled-components-multiple-expressions.js
- js/multiparser-css/styled-components.js
- js/multiparser-css/url.js
- js/multiparser-css/var.js
- js/multiparser-graphql/comment-tag.js
- js/multiparser-graphql/definitions.js
- js/multiparser-graphql/escape.js
- js/multiparser-graphql/expressions.js
- js/multiparser-graphql/graphql-tag.js
- js/multiparser-graphql/graphql.js
- js/multiparser-graphql/invalid.js
- js/multiparser-graphql/react-relay.js
- js/multiparser-html/html-template-literals.js
- js/multiparser-html/issue-10691.js
- js/multiparser-html/lit-html.js
- js/multiparser-html/language-comment/not-language-comment.js
- js/multiparser-invalid/text.js
- js/multiparser-markdown/0-indent.js
- js/multiparser-markdown/codeblock.js
- js/multiparser-markdown/escape.js
- js/multiparser-markdown/issue-5021.js
- js/multiparser-markdown/markdown.js
- js/multiparser-markdown/single-line.js
- js/multiparser-text/text.js
- js/no-semi-babylon-extensions/no-semi.js
- js/objects/expression.js
- js/optional-chaining-assignment/invalid-destructuring-arr.js
- js/optional-chaining-assignment/invalid-destructuring-obj.js
- js/optional-chaining-assignment/invalid-fn-param-arrow.js
- js/optional-chaining-assignment/invalid-fn-param-assign.js
- js/optional-chaining-assignment/invalid-fn-param.js
- js/optional-chaining-assignment/invalid-for-await-of.js
- js/optional-chaining-assignment/invalid-for-in.js
- js/optional-chaining-assignment/invalid-for-of.js
- js/optional-chaining-assignment/invalid-inc-postfix.js
- js/optional-chaining-assignment/invalid-inc-prefix.js
- js/optional-chaining-assignment/valid-complex-case.js
- js/optional-chaining-assignment/valid-lhs-eq.js
- js/optional-chaining-assignment/valid-lhs-plus-eq.js
- js/optional-chaining-assignment/valid-parenthesized.js
- js/partial-application/test.js
- js/pipeline-operator/block-comments.js
- js/pipeline-operator/fsharp_style_pipeline_operator.js
- js/pipeline-operator/hack_pipeline_operator.js
- js/pipeline-operator/minimal_pipeline_operator.js
- js/quotes/objects.js
- js/source-phase-imports/default-binding.js
- js/source-phase-imports/import-source-attributes-declaration.js
- js/source-phase-imports/import-source-attributes-expression.js
- js/source-phase-imports/import-source-binding-from.js
- js/source-phase-imports/import-source-binding-source.js
- js/source-phase-imports/import-source-dynamic-import.js
- js/source-phase-imports/import-source.js
- js/source-phase-imports/no-named.js
- js/source-phase-imports/no-namespace.js
- js/strings/template-literals.js
- js/template-literals/css-prop.js
- js/template-literals/styled-components-with-expressions.js
- js/template-literals/styled-jsx-with-expressions.js
- js/template-literals/styled-jsx.js
- js/ternaries/parenthesis/await-expression.js
- js/throw_expressions/throw_expression.js
- js/top-level-await/example.js
- js/top-level-await/in-expression.js
- js/top-level-await/test.cjs
- js/top-level-await/test.js
- js/top-level-await/test.mjs
- jsx/do/do.js
- jsx/template/styled-components.js
- jsx/top-level-await/test.jsx

## spec not evaluable (ReferenceError: beforeAll is not defined) (31)

- js/cursor/comments-1.js
- js/cursor/comments-2.js
- js/cursor/comments-3.js
- js/cursor/comments-4.js
- js/cursor/cursor-0.js
- js/cursor/cursor-1.js
- js/cursor/cursor-10.js
- js/cursor/cursor-11.js
- js/cursor/cursor-12.js
- js/cursor/cursor-13.js
- js/cursor/cursor-2.js
- js/cursor/cursor-3.js
- js/cursor/cursor-4.js
- js/cursor/cursor-5.js
- js/cursor/cursor-6.js
- js/cursor/cursor-7.js
- js/cursor/cursor-8.js
- js/cursor/cursor-9.js
- js/cursor/cursor-emoji.js
- js/cursor/file-start-with-comment-1.js
- js/cursor/file-start-with-comment-2.js
- js/cursor/file-start-with-comment-3.js
- js/cursor/range-0.js
- js/cursor/range-1.js
- js/cursor/range-2.js
- js/cursor/range-3.js
- js/cursor/range-4.js
- js/cursor/range-5.js
- js/cursor/range-6.js
- js/cursor/range-7.js
- js/cursor/range-8.js

## the spec expects the parser to reject it (47)

- js/_errors_/html-like-comments.js
- js/_errors_/import-attributes-for-export-without-from.js
- js/_errors_/import-attributes-with-parens.js
- js/_errors_/invalid-escape-in-identifier-2.js
- js/_errors_/invalid-escape-in-identifier.js
- js/_errors_/module-attributes.js
- js/_errors_/no-for-in-init-concise-binary-in.js
- js/_errors_/partial-template-strings.js
- js/_errors_/static-import-source-should-not-has-extra-token.js
- js/_errors_/deferred-import-evaluation/no-default.js
- js/_errors_/deferred-import-evaluation/no-named.js
- js/_errors_/discard-binding/invalid-array-expression.js
- js/_errors_/discard-binding/invalid-assignment-expression.js
- js/_errors_/discard-binding/invalid-assignment-for.js
- js/_errors_/discard-binding/invalid-assignment-pattern.js
- js/_errors_/discard-binding/invalid-async-call-argument.js
- js/_errors_/discard-binding/invalid-catch-parameter.js
- js/_errors_/discard-binding/invalid-lone-arrow-function-parameter.js
- js/_errors_/discard-binding/invalid-lone-async-arrow-function-parameter.js
- js/_errors_/discard-binding/invalid-object-expression.js
- js/_errors_/discard-binding/invalid-parenthesized-assignment.js
- js/_errors_/discard-binding/invalid-parenthesized-binding.js
- js/_errors_/discard-binding/invalid-rest-element-array-pattern-for-lhs.js
- js/_errors_/discard-binding/invalid-rest-element-array-pattern-lhs.js
- js/_errors_/discard-binding/invalid-rest-element-array-pattern.js
- js/_errors_/discard-binding/invalid-rest-element-object-pattern-for-lhs.js
- js/_errors_/discard-binding/invalid-rest-element-object-pattern-lhs.js
- js/_errors_/discard-binding/invalid-rest-element-object-pattern.js
- js/_errors_/discard-binding/invalid-sequence-expression.js
- js/_errors_/discard-binding/invalid-variable-declarator.js
- js/_errors_/explicit-resource-management/invalid-for-await-using-binding-of-of.js
- js/_errors_/explicit-resource-management/invalid-for-using-binding-in.js
- js/_errors_/explicit-resource-management/invalid-for-using-binding-of-in.js
- js/_errors_/explicit-resource-management/invalid-for-using-binding-of-of.js
- js/_errors_/explicit-resource-management/invalid-using-binding-let.js
- js/_errors_/explicit-resource-management/invalid-using-binding-pattern.js
- js/_errors_/hack-pipeline/v8intrinsic.js
- js/_errors_/literal/invalid-exponent.js
- js/_errors_/newline-before-arrow/newline-before-arrow.js
- js/_errors_/object/getter-generator.js
- js/_errors_/object/getter-with-parameter.js
- js/_errors_/object/setter-generator.js
- js/_errors_/object/setter-without-parameter.js
- js/_errors_/regex-v-u-flags/invalid-flags.js
- js/_errors_/regex-v-u-flags/invalid-flags2.js
- js/_errors_/variable-declarator/invalid-const.js
- js/comments/html-like/comment.js
