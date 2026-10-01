js@oxfmt compatibility: 939/964 (97.41%), 4 refused (ok:false), 190 excluded

Fixtures: prettier 3.9.9 tests/format/{js,jsx} (recursive), every spec call listing parser `babel` or `acorn` or `espree` or `meriyah` or `oxc`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| js/comments-closure-typecast/styled-components.js | 0/1 | 40.00% |
| js/ignore/issue-10661.js | 0/1 | 66.67% |
| js/ignore/issue-9877.js | 0/1 | 58.82% |
| js/ignore/semi/class-expression-decorator.js | 0/1 | 25.00% |
| js/multiparser-css/issue-11797.js | 0/1 | 81.48% |
| js/multiparser-css/issue-2883.js | 0/1 | 83.33% |
| js/multiparser-graphql/comment-tag.js | 0/1 | 76.92% |
| js/multiparser-graphql/escape.js | 0/1 | 82.93% |
| js/multiparser-graphql/expressions.js | 0/1 | 40.91% |
| js/multiparser-graphql/graphql-tag.js | 0/1 | 72.44% |
| js/multiparser-graphql/graphql.js | 0/1 | 38.10% |
| js/multiparser-graphql/react-relay.js | 0/1 | 36.84% |
| js/multiparser-html/issue-10691.js | 0/2 | 30.98% |
| js/multiparser-markdown/0-indent.js | 0/1 | 87.80% |
| js/multiparser-markdown/escape.js | 0/1 | 84.62% |
| js/multiparser-markdown/issue-5021.js | 0/1 | 92.96% |
| js/multiparser-markdown/markdown.js | 0/1 | 12.50% |
| js/multiparser-markdown/single-line.js | 0/1 | 0.00% |
| js/multiparser-text/text.js | 0/1 | 66.67% |
| js/ternaries/parenthesis/await-expression.js | 0/1 | 66.67% |
| jsx/template/styled-components.js | 0/1 | 93.94% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| js/_errors_/html-like-comments.js | 1/1 | 28.57% | check: input "<!-- comment" at 49 is output as "\"hello world\"" at 48, which means "str:hello world@\|0/4", not "<!-- co |
| js/comments/html-like/comment.js | 1/1 | 50.00% | check: input "<!--" at 0 is output as "alert" at 0, which means "alert@function\|0/3", not "<!--@\|0/1" |
| js/multiparser-html/html-template-literals.js | 2/2 | 66.50% | check: input "\"\nsingle-quoted='" at 642 is output as "\"\n  single-quoted=\"" at 643, which means "embed:\"single-quot |
| js/multiparser-html/lit-html.js | 2/2 | 54.63% | check: input "<my-element obj=" at 762 is output as "<my-element obj=\"" at 714, which means "embed:<my-elementobj=\"#0@ |

# Excluded

## oxfmt 0.70.0 is not idempotent on it (13)

- js/arrays/numbers-negative-comment-after-minus.js
- js/arrays/numbers-with-holes.js
- js/comments/return-statement.js
- js/comments/first-argument/first-argument.js
- js/for/continue-and-break-comment-without-blocks.js
- js/function/issue-12967.js
- js/ignore/semi/class-expression-decorator.js {"semi":false}
- js/ignore/semi/head-ignored.js {"semi":false}
- js/last-argument-expansion/embed.js
- js/multiparser-markdown/codeblock.js
- js/object-prop-break-in/short-keys.js
- jsx/comments/in-attributes.js
- jsx/spread/child.js

## oxfmt 0.70.0 rejects it: `for await` loops are only allowed within async functions and at the top levels of modules (2)

- js/explicit-resource-management/for-await-using-of-comments.js
- js/explicit-resource-management/valid-using-as-identifier-for-await-of.js

## oxfmt 0.70.0 rejects it: A 'get' accessor must not have any formal parameters. (1)

- js/_errors_/object/getter-with-parameter.js

## oxfmt 0.70.0 rejects it: A 'set' accessor must have exactly one parameter. (1)

- js/_errors_/object/setter-without-parameter.js

## oxfmt 0.70.0 rejects it: A reserved word cannot be used as an exported binding without `from` (1)

- js/_errors_/import-attributes-for-export-without-from.js

## oxfmt 0.70.0 rejects it: Bad escape sequence in untagged template literal (1)

- js/multiparser-invalid/text.js

## oxfmt 0.70.0 rejects it: Cannot assign to this expression (13)

- js/_errors_/no-for-in-init-concise-binary-in.js
- js/babel-plugins/optional-chaining-assignment.js
- js/optional-chaining-assignment/invalid-destructuring-arr.js
- js/optional-chaining-assignment/invalid-destructuring-obj.js
- js/optional-chaining-assignment/invalid-for-await-of.js
- js/optional-chaining-assignment/invalid-for-in.js
- js/optional-chaining-assignment/invalid-for-of.js
- js/optional-chaining-assignment/invalid-inc-postfix.js
- js/optional-chaining-assignment/invalid-inc-prefix.js
- js/optional-chaining-assignment/valid-complex-case.js
- js/optional-chaining-assignment/valid-lhs-eq.js
- js/optional-chaining-assignment/valid-lhs-plus-eq.js
- js/optional-chaining-assignment/valid-parenthesized.js

## oxfmt 0.70.0 rejects it: Default imports are not allowed in a deferred import. (1)

- js/_errors_/deferred-import-evaluation/no-default.js

## oxfmt 0.70.0 rejects it: Expected ` (2)

- js/discard-binding/discard-binding-for-await-using-binding.js
- js/discard-binding/discard-binding-for-using-binding.js

## oxfmt 0.70.0 rejects it: Expected `,` or `)` but found `:` (3)

- js/arrows-bind/arrows-bind.js
- js/babel-plugins/flow.js
- js/objects/expression.js

## oxfmt 0.70.0 rejects it: Expected `,` or `)` but found `?.` (2)

- js/optional-chaining-assignment/invalid-fn-param-assign.js
- js/optional-chaining-assignment/invalid-fn-param.js

## oxfmt 0.70.0 rejects it: Expected `,` or `)` but found `{` (1)

- js/module-blocks/quote-props/worker.js

## oxfmt 0.70.0 rejects it: Expected `,` or `}` but found `*` (2)

- js/_errors_/object/getter-generator.js
- js/_errors_/object/setter-generator.js

## oxfmt 0.70.0 rejects it: Expected `(` but found `.` (1)

- js/babel-plugins/function-sent.js

## oxfmt 0.70.0 rejects it: Expected `)` but found `of` (2)

- js/_errors_/explicit-resource-management/invalid-for-await-using-binding-of-of.js
- js/_errors_/explicit-resource-management/invalid-for-using-binding-of-of.js

## oxfmt 0.70.0 rejects it: Expected `{` but found `(` (1)

- js/_errors_/import-attributes-with-parens.js

## oxfmt 0.70.0 rejects it: Expected `{` but found `type` (1)

- js/_errors_/module-attributes.js

## oxfmt 0.70.0 rejects it: Expected a semicolon or an implicit semicolon after a statement, but found none (15)

- js/_errors_/discard-binding/invalid-lone-async-arrow-function-parameter.js
- js/async-do-expressions/async-do-expressions.js
- js/babel-plugins/async-do-expressions.js
- js/babel-plugins/module-blocks.js
- js/bind-expressions/await.js
- js/bind-expressions/bind_parens.js
- js/bind-expressions/unary.js
- js/discard-binding/using-variable-declarator.js
- js/discard-binding/using.js
- js/explicit-resource-management/valid-module-block-top-level-await-using-binding.js
- js/explicit-resource-management/valid-module-block-top-level-using-binding.js
- js/module-blocks/comments.js
- js/module-blocks/module-blocks.js
- js/module-blocks/range.js
- js/optional-chaining-assignment/invalid-fn-param-arrow.js

## oxfmt 0.70.0 rejects it: Failed to parse configuration: unknown variant `auto`, expected one of `lf`, `crlf`, `cr` (4)

- js/eol/cursor-1.js {"endOfLine":"auto"}
- js/eol/cursor-and-range.js {"endOfLine":"auto"}
- js/eol/range-1.js {"endOfLine":"auto"}
- js/eol/range-and-cursor-1.js {"endOfLine":"auto"}

## oxfmt 0.70.0 rejects it: Failed to parse configuration: Unsupported option: `experimentalTernaries` (40)

- js/conditional/comments.js {"experimentalTernaries":true}
- js/conditional/issue-18944.js {"experimentalTernaries":true}
- js/conditional/new-expression.js {"experimentalTernaries":true}
- js/conditional/new-ternary-examples.js {"experimentalTernaries":true}
- js/conditional/new-ternary-spec.js {"experimentalTernaries":true}
- js/conditional/no-confusing-arrow.js {"experimentalTernaries":true}
- js/conditional/postfix-ternary-regressions.js {"experimentalTernaries":true}
- js/ternaries/binary.js {"experimentalTernaries":true}
- js/ternaries/binary.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/binary.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/binary.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/func-call.js {"experimentalTernaries":true}
- js/ternaries/func-call.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/func-call.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/func-call.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/indent-after-paren.js {"experimentalTernaries":true}
- js/ternaries/indent-after-paren.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/indent-after-paren.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/indent-after-paren.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/indent.js {"experimentalTernaries":true}
- js/ternaries/indent.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/indent.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/indent.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/nested-in-condition.js {"experimentalTernaries":true}
- js/ternaries/nested-in-condition.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/nested-in-condition.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/nested-in-condition.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/nested.js {"experimentalTernaries":true}
- js/ternaries/nested.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/nested.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/nested.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/parenthesis.js {"experimentalTernaries":true}
- js/ternaries/parenthesis.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/parenthesis.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/parenthesis.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/test.js {"experimentalTernaries":true}
- js/ternaries/test.js {"experimentalTernaries":true,"tabWidth":4}
- js/ternaries/test.js {"experimentalTernaries":true,"useTabs":true}
- js/ternaries/test.js {"experimentalTernaries":true,"useTabs":true,"tabWidth":4}
- js/ternaries/parenthesis/await-expression.js {"experimentalTernaries":true}

## oxfmt 0.70.0 rejects it: Identifier `type` has already been declared (2)

- js/import-assertions/multi-types.js
- js/import-attributes/multi-types.js

## oxfmt 0.70.0 rejects it: Identifier expected. 'void' is a reserved word that cannot be used here. (12)

- js/_errors_/discard-binding/invalid-assignment-pattern.js
- js/_errors_/discard-binding/invalid-catch-parameter.js
- js/_errors_/discard-binding/invalid-rest-element-array-pattern.js
- js/_errors_/discard-binding/invalid-rest-element-object-pattern.js
- js/_errors_/discard-binding/invalid-variable-declarator.js
- js/babel-plugins/discard-binding.js
- js/discard-binding/array-pattern.js
- js/discard-binding/basic.js
- js/discard-binding/discard-binding-bindings.js
- js/discard-binding/discard-binding-for-bindings.js
- js/discard-binding/function-parameter.js
- js/discard-binding/object-pattern.js

## oxfmt 0.70.0 rejects it: Invalid Character ` (1)

- js/_errors_/literal/invalid-exponent.js

## oxfmt 0.70.0 rejects it: Invalid Character ` ` (1)

- js/_errors_/invalid-escape-in-identifier.js

## oxfmt 0.70.0 rejects it: Invalid Unicode escape sequence (1)

- js/_errors_/invalid-escape-in-identifier-2.js

## oxfmt 0.70.0 rejects it: Line terminator not permitted before arrow (1)

- js/_errors_/newline-before-arrow/newline-before-arrow.js

## oxfmt 0.70.0 rejects it: Missing initializer in const declaration (2)

- js/_errors_/variable-declarator/invalid-const.js
- js/babel-plugins/typescript.js

## oxfmt 0.70.0 rejects it: Named imports are not allowed in a deferred import. (1)

- js/_errors_/deferred-import-evaluation/no-named.js

## oxfmt 0.70.0 rejects it: Only a single default import is allowed in a source phase import. (2)

- js/source-phase-imports/no-named.js
- js/source-phase-imports/no-namespace.js

## oxfmt 0.70.0 rejects it: Private identifier '#x' is not allowed in property names (8)

- js/babel-plugins/destructuring-private.js
- js/destructuring-private-fields/arrow-params.js
- js/destructuring-private-fields/assignment.js
- js/destructuring-private-fields/async-arrow-params.js
- js/destructuring-private-fields/bindings.js
- js/destructuring-private-fields/for-lhs.js
- js/destructuring-private-fields/nested-bindings.js
- js/destructuring-private-fields/valid-multiple-bindings.js

## oxfmt 0.70.0 rejects it: The 'u' and 'v' regular expression flags cannot be enabled at the same time (2)

- js/_errors_/regex-v-u-flags/invalid-flags.js
- js/_errors_/regex-v-u-flags/invalid-flags2.js

## oxfmt 0.70.0 rejects it: The left-hand side of a for...in statement cannot be an using declaration. (1)

- js/_errors_/explicit-resource-management/invalid-for-using-binding-in.js

## oxfmt 0.70.0 rejects it: Unexpected new.target expression (1)

- js/new-target/outside-functions.js

## oxfmt 0.70.0 rejects it: Unexpected token (47)

- js/_errors_/partial-template-strings.js
- js/_errors_/static-import-source-should-not-has-extra-token.js
- js/_errors_/discard-binding/invalid-array-expression.js
- js/_errors_/discard-binding/invalid-assignment-expression.js
- js/_errors_/discard-binding/invalid-assignment-for.js
- js/_errors_/discard-binding/invalid-async-call-argument.js
- js/_errors_/discard-binding/invalid-lone-arrow-function-parameter.js
- js/_errors_/discard-binding/invalid-object-expression.js
- js/_errors_/discard-binding/invalid-parenthesized-assignment.js
- js/_errors_/discard-binding/invalid-parenthesized-binding.js
- js/_errors_/discard-binding/invalid-rest-element-array-pattern-for-lhs.js
- js/_errors_/discard-binding/invalid-rest-element-array-pattern-lhs.js
- js/_errors_/discard-binding/invalid-rest-element-object-pattern-for-lhs.js
- js/_errors_/discard-binding/invalid-rest-element-object-pattern-lhs.js
- js/_errors_/discard-binding/invalid-sequence-expression.js
- js/_errors_/explicit-resource-management/invalid-for-using-binding-of-in.js
- js/_errors_/hack-pipeline/v8intrinsic.js
- js/babel-plugins/do-expressions.js
- js/babel-plugins/export-default-from.js
- js/babel-plugins/function-bind.js
- js/babel-plugins/partial-application.js
- js/babel-plugins/pipeline-operator-fsharp.js
- js/babel-plugins/pipeline-operator-hack.cjs
- js/babel-plugins/pipeline-operator-minimal.js
- js/babel-plugins/throw-expressions.js
- js/bind-expressions/long_name_method.js
- js/bind-expressions/method_chain.js
- js/bind-expressions/short_name_method.js
- js/call/invalid/null-arguments-item.js
- js/comments-pipeline-own-line/pipeline_own_line.js
- js/discard-binding/discard-binding-arrow-params.js
- js/discard-binding/discard-binding-assignment.js
- js/discard-binding/discard-binding-async-arrow-params.js
- js/discard-binding/discard-binding-for-lhs.js
- js/discard-binding/unary-expression-void.js
- js/do/call-arguments.js
- js/do/do.js
- js/export-default/escaped/default-escaped.js
- js/export-default/export-default-from/export.js
- js/no-semi-babylon-extensions/no-semi.js
- js/partial-application/test.js
- js/pipeline-operator/block-comments.js
- js/pipeline-operator/fsharp_style_pipeline_operator.js
- js/pipeline-operator/hack_pipeline_operator.js
- js/pipeline-operator/minimal_pipeline_operator.js
- js/throw_expressions/throw_expression.js
- jsx/do/do.js

## oxfmt 0.70.0 rejects it: Using declarations may not have binding patterns. (1)

- js/_errors_/explicit-resource-management/invalid-using-binding-pattern.js
