js compatibility: 614/804 (76.37%), 32 refused (ok:false), 304 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 563/804 (70.02%)

Fixtures: prettier 3.9.9 tests/format/{js,jsx} (recursive), every spec call listing parser `babel` or `acorn` or `espree` or `meriyah` or `oxc`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| js/arrays/numbers-with-holes.js | 0/1 | 57.78% |
| js/arrays/preserve_empty_lines.js | 0/1 | 88.41% |
| js/arrows/arrow-chain-with-trailing-comments.js | 0/2 | 75.00% |
| js/arrows/arrow_function_expression.js | 0/2 | 94.29% |
| js/arrows/comment.js | 0/2 | 67.57% |
| js/arrows/currying-4.js | 0/2 | 96.33% |
| js/arrows/issue-17421.js | 0/2 | 82.51% |
| js/arrows/comments/comment-before-arrow.js | 0/1 | 66.67% |
| js/arrows/parenthesized-body/issue-18776.js | 0/1 | 85.71% |
| js/assignment/destructuring-heuristic.js | 0/1 | 84.00% |
| js/assignment-comments/function.js | 0/1 | 84.91% |
| js/assignment-comments/number.js | 0/1 | 87.50% |
| js/async/nested.js | 0/1 | 14.29% |
| js/async/simple-nested-await.js | 0/1 | 50.00% |
| js/await/await-with-parens.js | 0/1 | 76.19% |
| js/chain-expression/call-expression.js | 0/1 | 96.00% |
| js/chain-expression/member-chain.js | 0/1 | 57.14% |
| js/chain-expression/member-expression.js | 0/1 | 96.43% |
| js/chain-expression/new-expression.js | 0/1 | 95.83% |
| js/class-comment/misc.js | 0/1 | 72.73% |
| js/classes/multiple-static.js | 0/1 | 40.00% |
| js/comments/11273.js | 0/2 | 57.14% |
| js/comments/array-and-object.js | 0/2 | 62.50% |
| js/comments/blank.js | 0/2 | 92.31% |
| js/comments/export-and-import.js | 0/2 | 78.05% |
| js/comments/export.js | 0/2 | 86.67% |
| js/comments/function-declaration.js | 0/2 | 75.20% |
| js/comments/if.js | 0/2 | 78.57% |
| js/comments/issue-3532.js | 0/2 | 91.67% |
| js/comments/issues.js | 0/2 | 83.58% |
| js/comments/jsdoc-nestled-dangling.js | 0/2 | 93.02% |
| js/comments/jsdoc-nestled.js | 0/2 | 81.36% |
| js/comments/jsdoc.js | 1/2 | 96.15% |
| js/comments/return-statement.js | 0/2 | 98.34% |
| js/comments/tagged-template-literal.js | 0/2 | 92.86% |
| js/comments/trailing-jsdocs.js | 0/2 | 76.00% |
| js/comments/variable-declarator.js | 0/2 | 71.11% |
| js/comments-closure-typecast/array-and-object.js | 0/1 | 69.23% |
| js/comments-closure-typecast/binary-expr.js | 0/1 | 0.00% |
| js/comments-closure-typecast/closure-compiler-type-cast.js | 0/1 | 68.25% |
| js/comments-closure-typecast/comment-placement.js | 0/1 | 61.54% |
| js/comments-closure-typecast/extra-spaces-and-asterisks.js | 0/1 | 0.00% |
| js/comments-closure-typecast/iife-issue-5850-isolated.js | 0/1 | 0.00% |
| js/comments-closure-typecast/iife.js | 0/1 | 18.18% |
| js/comments-closure-typecast/issue-4124.js | 0/1 | 35.00% |
| js/comments-closure-typecast/issue-9358.js | 0/1 | 0.00% |
| js/comments-closure-typecast/member.js | 0/1 | 0.00% |
| js/comments-closure-typecast/nested.js | 0/1 | 12.50% |
| js/comments-closure-typecast/object-with-comment.js | 0/1 | 28.57% |
| js/comments-closure-typecast/satisfies.js | 0/1 | 33.33% |
| js/comments-closure-typecast/superclass.js | 0/1 | 0.00% |
| js/comments-closure-typecast/ways-to-specify-type.js | 0/1 | 15.38% |
| js/comments-closure-typecast/no-semi/comments.js | 0/1 | 72.22% |
| js/comments-closure-typecast/no-semi/multiline.js | 0/1 | 60.00% |
| js/comments-closure-typecast/no-semi/not-on-same-line.js | 0/1 | 81.82% |
| js/comments-closure-typecast/no-semi/with-other-comments.js | 0/1 | 50.00% |
| js/comments/assignment/variable-declarator.js | 0/1 | 15.38% |
| js/comments/function/18146.js | 0/1 | 58.06% |
| js/comments/function/between-parentheses-and-function-body.js | 0/1 | 52.63% |
| js/comments/in-list/dangling-comment-in-list.js | 0/1 | 95.95% |
| js/comments/tagged-template-literal/11662.js | 0/1 | 80.00% |
| js/comments/while-like/if.js | 0/1 | 91.84% |
| js/comments/while-like/switch.js | 0/1 | 84.44% |
| js/comments/while-like/while.js | 0/1 | 90.24% |
| js/comments/while-like/with.js | 0/1 | 91.84% |
| js/conditional/comments.js | 0/2 | 66.50% |
| js/decorator-auto-accessors/basic.js | 1/2 | 83.33% |
| js/decorator-auto-accessors/comments.js | 1/2 | 90.00% |
| js/decorator-auto-accessors/computed.js | 1/2 | 83.33% |
| js/decorator-auto-accessors/private.js | 1/2 | 83.33% |
| js/decorator-auto-accessors/static-computed.js | 1/2 | 83.33% |
| js/decorator-auto-accessors/static-private.js | 1/2 | 83.33% |
| js/decorator-auto-accessors/static.js | 1/2 | 83.33% |
| js/decorators/member-expression.js | 0/1 | 90.91% |
| js/decorators/parens.js | 0/1 | 75.00% |
| js/decorators/class-expression/class-expression.js | 0/2 | 55.56% |
| js/decorators/class-expression/member-expression.js | 0/2 | 0.00% |
| js/decorators/class-expression/super-class.js | 0/2 | 14.29% |
| js/destructuring/issue-5988.js | 0/1 | 0.00% |
| js/discard-binding/array-pattern.js | 0/1 | 81.08% |
| js/discard-binding/basic.js | 0/1 | 40.00% |
| js/discard-binding/discard-binding-for-await-using-binding.js | 0/1 | 28.57% |
| js/discard-binding/discard-binding-for-using-binding.js | 0/1 | 57.14% |
| js/discard-binding/function-parameter.js | 0/1 | 86.36% |
| js/discard-binding/object-pattern.js | 0/1 | 67.39% |
| js/discard-binding/unary-expression-void.js | 0/1 | 83.33% |
| js/discard-binding/using-variable-declarator.js | 0/1 | 73.97% |
| js/embeded/indention/19518.js | 0/1 | 46.38% |
| js/embeded/indention/indention-2.js | 0/1 | 23.53% |
| js/embeded/indention/indention.js | 0/1 | 63.27% |
| js/empty-paren-comment/empty_paren_comment.js | 0/1 | 91.43% |
| js/explicit-resource-management/for-await-using-of-comments.js | 0/1 | 0.00% |
| js/explicit-resource-management/using-declarations.js | 0/1 | 87.50% |
| js/explicit-resource-management/valid-await-expr-using-in.js | 0/1 | 66.67% |
| js/explicit-resource-management/valid-await-expr-using-instanceof.js | 0/1 | 66.67% |
| js/explicit-resource-management/valid-await-expr-using.js | 0/1 | 50.00% |
| js/explicit-resource-management/valid-await-using-asi-assignment.js | 0/1 | 57.14% |
| js/explicit-resource-management/valid-await-using-binding-escaped.js | 0/1 | 66.67% |
| js/explicit-resource-management/valid-module-block-top-level-await-using-binding.js | 0/1 | 28.57% |
| js/explicit-resource-management/valid-module-block-top-level-using-binding.js | 0/1 | 28.57% |
| js/explicit-resource-management/valid-using-as-identifier-computed-member.js | 0/1 | 0.00% |
| js/explicit-resource-management/valid-using-as-identifier-expression-statement.js | 0/1 | 0.00% |
| js/explicit-resource-management/valid-using-as-identifier-for-in.js | 0/1 | 88.89% |
| js/explicit-resource-management/valid-using-as-identifier-for-init.js | 0/1 | 0.00% |
| js/explicit-resource-management/valid-using-as-identifier-in.js | 0/1 | 66.67% |
| js/explicit-resource-management/valid-using-binding-escaped.js | 0/1 | 66.67% |
| js/export/blank-line-between-specifiers.js | 0/2 | 95.00% |
| js/export-default/function_tostring.js | 0/1 | 0.00% |
| js/export-star/export-star-as-reserved-word.js | 0/1 | 50.00% |
| js/for/continue-and-break-comment-without-blocks.js | 0/1 | 94.66% |
| js/for/for-in-with-initializer.js | 0/1 | 38.71% |
| js/function/iife.js | 0/1 | 22.68% |
| js/function/issue-12967.js | 0/1 | 0.00% |
| js/if/blank-lines.js | 0/1 | 72.55% |
| js/if/comment-between-condition-and-body.js | 0/1 | 96.10% |
| js/if/comment_before_else.js | 0/1 | 88.00% |
| js/if/if_comments.js | 0/1 | 91.89% |
| js/if/condition-break/boolean-expression.js | 0/1 | 97.01% |
| js/if/condition-break/unary-expression.js | 0/1 | 97.06% |
| js/import-assertions/empty.js | 0/1 | 14.29% |
| js/import-assertions/re-export.js | 0/1 | 85.71% |
| js/import-assertions/without-from.js | 0/1 | 0.00% |
| js/import-assertions/bracket-spacing/empty.js | 0/1 | 0.00% |
| js/import-assertions/bracket-spacing/re-export.js | 0/1 | 0.00% |
| js/import-assertions/bracket-spacing/static-import.js | 0/1 | 0.00% |
| js/import-attributes/empty.js | 0/1 | 57.14% |
| js/import-attributes/keyword-detect.js | 0/1 | 30.77% |
| js/import-attributes/long-sources.js | 0/1 | 86.54% |
| js/import-attributes/re-export.js | 0/1 | 85.71% |
| js/import-attributes/bracket-spacing/empty.js | 0/1 | 0.00% |
| js/import-attributes/bracket-spacing/re-export.js | 0/1 | 0.00% |
| js/import-attributes/quote-props/quoted-keys.js | 1/3 | 86.67% |
| js/label/comment.js | 0/1 | 53.33% |
| js/last-argument-expansion/edge_case.js | 0/1 | 74.63% |
| js/method-chain/break-last-member.js | 0/1 | 85.29% |
| js/method-chain/comment.js | 0/1 | 76.27% |
| js/method-chain/issue-11298.js | 0/1 | 20.00% |
| js/newline/backslash_2028.js | 0/1 | 40.00% |
| js/newline/backslash_2029.js | 0/1 | 40.00% |
| js/object-prop-break-in/test.js | 0/1 | 89.55% |
| js/optional-chaining/chaining.js | 0/1 | 97.70% |
| js/preserve-line/member-chain.js | 0/1 | 85.07% |
| js/reserved-word/yield.js | 0/1 | 93.33% |
| js/sequence-break/break.js | 0/1 | 85.29% |
| js/sequence-expression/ignore.js | 0/1 | 72.73% |
| js/sequence-expression/parenthesized-trailing-comment.js | 0/1 | 77.14% |
| js/sequence-expression/parenthesized.js | 0/1 | 85.71% |
| js/strings/multiline-literal.js | 0/2 | 70.00% |
| js/switch/comments.js | 0/1 | 90.37% |
| js/switch/comments2.js | 0/1 | 84.21% |
| js/template/graphql.js | 0/1 | 82.76% |
| js/template/inline.js | 0/1 | 94.34% |
| js/template-literals/expression-break.js | 0/1 | 80.00% |
| js/template-literals/indention.js | 0/1 | 29.75% |
| js/test-declarations/jest-each-template-string.js | 0/2 | 27.78% |
| js/test-declarations/jest-each.js | 0/2 | 63.24% |
| js/throw_statement/comment.js | 0/1 | 43.24% |
| jsx/ignore/spread.js | 0/1 | 75.68% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| js/call/no-argument/no-arguments.js | 1/1 | 64.86% | check: input comment "// 108" is missing from the output |
| js/chain-expression/tagged-template-literals.js | 1/1 | 61.90% | check: input "a" at 23 is output as "a" at 22, which means "a@object\|0/4", not "a@object\|0/5" |
| js/class-comment/superclass.js | 1/1 | 68.24% | check: input comment "// comment 2" is missing from the output |
| js/comments/15661.js | 2/2 | 17.74% | check: input "!" at 0 is output as "!" at 0, which means "!@operator\|-1/4", not "!@operator\|-1/3" |
| js/comments/break-continue-statements-3.js | 2/2 | 95.83% | check: output comment "// breaking comment;" matches no input comment |
| js/comments/dangling_for.js | 2/2 | 28.57% | check: input comment "// comment" is missing from the output |
| js/comments/empty-statements.js | 2/2 | 17.39% | check: output comment "// second // third // first" matches no input comment |
| js/comments/return-statement-2.js | 2/2 | 84.67% | check: input "!" at 433 is output as "!" at 438, which means "!@operator\|-1/29", not "!@operator\|-1/27" |
| js/comments/trailing_space.js | 2/2 | 100.00% | check: input "#!/there/is-space-here->         " at 0 is output as "#!/there/is-space-here->" at 0, which means "#!/ther |
| js/comments-closure-typecast/issue-8045.js | 1/1 | 46.15% | check: input "fooBarBaz" at 446 is output as "fooBarBaz" at 434, which means "fooBarBaz@\|0/14", not "fooBarBaz@\|0/13" |
| js/comments/between-head-and-body/between-head-and-body.js | 1/1 | 60.15% | check: input comment "// 14" is missing from the output |
| js/comments/between-head-and-body/empty-statement.js | 1/1 | 51.35% | check: input comment "// 14" is missing from the output |
| js/comments/between-head-and-body/non-block.js | 1/1 | 64.25% | check: input comment "// 14" is missing from the output |
| js/decorators/comments.js | 1/1 | 93.94% | check: output comment "// B // C export // C" matches no input comment |
| js/decorators-export/after_export.js | 1/1 | 76.92% | check: input "export" at 0 is output as "export" at 0, which means "export@\|0/2", not "export@\|-1/2" |
| js/directives/issue-7346.js | 1/1 | 100.00% | check: input "'bar'" at 78 is output as "\"bar\"" at 79, which means "str:bar@\|0/7", not "str:bar@\|0/6" |
| js/explicit-resource-management/valid-await-using-comments.js | 1/1 | 70.97% | check: input comment "/*8*/" is missing from the output |
| js/for-of/comments.js | 1/1 | 88.46% | check: output comment "//2b //2c" matches no input comment |
| js/identifier/for-of/let.js | 1/1 | 69.23% | check: input "let" at 107 is output as "let" at 104, which means "let@kind\|-1/10", not "let@object\|0/11" |
| js/identifier/parentheses/let.js | 2/2 | 88.18% | check: the output has a syntax error at 43, which the input has not |
| js/import/comments.js | 2/2 | 63.41% | check: output comment "//comment2 //comment1" matches no input comment |
| js/import-assertions/keyword-detect.js | 1/1 | 20.00% | check: output comment "/* with */" matches no input comment |
| js/import/empty-import/empty-import-2.js | 1/1 | 50.00% | check: output comment "/* 😄😄😄😄 */" matches no input comment |
| js/import/empty-import/empty-import.js | 1/1 | 32.43% | check: output comment "// comment // comment" matches no input comment |
| js/logical-expressions/in-unary-expression.js | 1/1 | 71.62% | check: input "!" at 107 is output as "!" at 107, which means "!@operator\|-1/5", not "!@operator\|-1/4" |
| js/new-expression/new-expression.js | 1/1 | 88.89% | check: input "new" at 80 is output as "new" at 86, which means "new@\|-1/16", not "new@\|-1/14" |
| js/optional-chaining/comments.js | 1/1 | 71.91% | check: input comment "// Comment" is missing from the output |
| js/quotes/strings.js | 2/2 | 100.00% | check: input "\"abc\"" at 497 is output as "\"abc\"" at 498, which means "str:abc@\|0/4", not "str:abc@\|0/3" |
| js/return/comment.js | 1/1 | 57.14% | check: input comment "//comment" is missing from the output |
| js/unary-expression/comments.js | 1/1 | 16.74% | check: input "!" at 108 is output as "!" at 82, which means "!@operator\|-1/19", not "!@operator\|-1/18" |
| js/v8_intrinsic/intrinsic_call.js | 1/1 | 45.45% | check: input "IsAsmWasmCode" at 138 is output as ")" at 112, which means ")@\|-1/13", not "IsAsmWasmCode@function\|0/14" |
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
