ts compatibility: 544/653 (83.31%), 28 refused (ok:false), 76 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 490/653 (75.04%)

Fixtures: prettier 3.9.9 tests/format/{typescript,jsx} (recursive), every spec call listing parser `typescript` or `babel-ts` or `oxc-ts`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| typescript/argument-expansion/arrow-with-return-type.ts | 0/1 | 77.78% |
| typescript/arrow/comments/issue-11100.ts | 0/1 | 42.86% |
| typescript/as/comments/18160.ts | 0/1 | 81.25% |
| typescript/assignment/lone-arg.ts | 0/1 | 41.18% |
| typescript/binary-expressions/chain-expression.ts | 0/1 | 76.47% |
| typescript/call/callee-comments.ts | 0/1 | 69.44% |
| typescript/cast/assert-and-assign.ts | 0/1 | 50.00% |
| typescript/chain-expression/issue-15785-1.ts | 0/1 | 66.67% |
| typescript/chain-expression/issue-15785-2.ts | 0/1 | 77.78% |
| typescript/chain-expression/test2.ts | 0/1 | 80.00% |
| typescript/class/declare-field.ts | 0/1 | 75.00% |
| typescript/class-and-interface/heritage-break/member-expression-like.ts | 0/1 | 75.00% |
| typescript/comments/11662.ts | 0/1 | 0.00% |
| typescript/comments/16065.ts | 0/1 | 81.82% |
| typescript/comments/16889.ts | 0/1 | 97.39% |
| typescript/comments/method_types.ts | 0/1 | 82.05% |
| typescript/comments/first-argument/first-argument.ts | 0/1 | 65.45% |
| typescript/compiler/indexSignatureWithInitializer.ts | 0/1 | 87.50% |
| typescript/conditional-types/parentheses.ts | 0/2 | 86.00% |
| typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractMixedWithModifiers.ts | 0/1 | 13.33% |
| typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractSingleLineDecl.ts | 0/1 | 66.67% |
| typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractWithInterface.ts | 0/1 | 0.00% |
| typescript/conformance/classes/constructorDeclarations/constructorParameters/readonlyInConstructorParameters.ts | 0/1 | 92.31% |
| typescript/conformance/types/interfaceDeclaration/interfaceDeclaration.ts | 0/1 | 80.00% |
| typescript/conformance/types/moduleDeclaration/kind-detection.ts | 0/1 | 0.00% |
| typescript/custom/abstract/abstractNewlineHandling.ts | 0/1 | 86.96% |
| typescript/custom/abstract/abstractProperties.ts | 0/1 | 25.00% |
| typescript/decorator-auto-accessors/decorator-auto-accessors-new-line.ts | 0/1 | 76.92% |
| typescript/decorator-auto-accessors/no-semi/decorator-auto-accessor-like-property-name.ts | 0/1 | 75.00% |
| typescript/decorators/decorator-type-assertion.ts | 0/1 | 40.00% |
| typescript/definite/definite.ts | 0/1 | 85.71% |
| typescript/definite/without-annotation.ts | 0/1 | 91.67% |
| typescript/explicit-resource-management/await-using-with-type-declaration.ts | 0/1 | 66.67% |
| typescript/explicit-resource-management/using-with-type-declaration.ts | 0/1 | 66.67% |
| typescript/export/export-type-star-from-2.ts | 0/1 | 66.67% |
| typescript/export/export-type-star-from.ts | 0/1 | 0.00% |
| typescript/import-require/comments.ts | 0/1 | 70.00% |
| typescript/import-require/type-imports.ts | 0/1 | 56.00% |
| typescript/import-type/import-type.ts | 0/2 | 87.10% |
| typescript/import-type/long-module-name/long-module-name.ts | 0/1 | 40.00% |
| typescript/import-type/long-module-name/long-module-name3.ts | 0/1 | 66.67% |
| typescript/instantiation-expression/inferface-asi.ts | 0/1 | 36.36% |
| typescript/instantiation-expression/logical-expr.ts | 0/1 | 91.67% |
| typescript/interface/ignore.ts | 0/2 | 86.79% |
| typescript/interface2/comments-ts-only/18278.ts | 0/1 | 82.61% |
| typescript/intersection/intersection-parens.ts | 1/3 | 99.29% |
| typescript/intersection/consistent-with-flow/intersection-parens.ts | 0/1 | 97.67% |
| typescript/last-argument-expansion/decorated-function.tsx | 0/1 | 90.91% |
| typescript/mapped-type/issue-11098.ts | 0/1 | 87.13% |
| typescript/method-chain/comment.ts | 0/1 | 0.00% |
| typescript/module/global.ts | 0/1 | 38.10% |
| typescript/new/with-member-expression.ts | 0/1 | 88.00% |
| typescript/non-null/braces.ts | 0/1 | 94.12% |
| typescript/object-type/empty/empty.ts | 0/2 | 84.48% |
| typescript/parentheses/await.ts | 0/1 | 66.67% |
| typescript/property-signature/consistent-with-flow/comments.ts | 0/1 | 80.00% |
| typescript/satisfies-operators/expression-statement.ts | 0/2 | 83.78% |
| typescript/satisfies-operators/lhs.ts | 0/2 | 90.00% |
| typescript/template-literals/expressions.ts | 0/1 | 0.00% |
| typescript/template-literals/member-expression.ts | 0/1 | 57.14% |
| typescript/ternaries/indent.ts | 0/1 | 95.80% |
| typescript/test-declarations/test_declarations.ts | 0/2 | 50.00% |
| typescript/trailing-comma/trailing.ts | 2/3 | 97.78% |
| typescript/tsx/optional-chaining.tsx | 0/1 | 73.33% |
| typescript/type-arguments-bit-shift-left-like/4.ts | 0/1 | 0.00% |
| typescript/type-parameters-arguments/18041.ts | 0/1 | 45.71% |
| typescript/type-parameters-arguments/const.ts | 0/1 | 90.63% |
| typescript/type-parameters-arguments/constraints-and-default-2.ts | 0/1 | 96.83% |
| typescript/type-parameters-arguments/long-function-arg.ts | 0/1 | 18.18% |
| typescript/type-parameters-arguments/tagged-template-expression.ts | 0/1 | 75.00% |
| typescript/type-parameters-arguments/consistent/simple-types.ts | 0/1 | 28.57% |
| typescript/type-parameters-arguments/consistent/template-literal-types.ts | 0/1 | 0.00% |
| typescript/type-parameters-arguments/consistent/typescript-only.ts | 0/1 | 70.59% |
| typescript/type-parameters-arguments/print-width-120/issue-7542.tsx | 0/1 | 88.89% |
| typescript/union/union-parens.ts | 0/1 | 99.07% |
| typescript/union/comments/18379.ts | 0/1 | 54.17% |
| typescript/union/comments/18389.ts | 0/1 | 76.92% |
| typescript/union/consistent-with-flow/leading-comments.ts | 0/1 | 82.86% |
| typescript/union/consistent-with-flow/prettier-ignore.ts | 0/1 | 60.00% |
| jsx/ignore/spread.js | 0/1 | 75.68% |
| jsx/jsx/html_escape.js | 2/4 | 66.67% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| typescript/chain-expression/new-expression.ts | 1/1 | 77.94% | check: input "new" at 281 is output as "new" at 227, which means "new@\|-1/82", not "new@\|-1/80" |
| typescript/chain-expression/tagged-template-literals.ts | 1/1 | 72.31% | check: input "a" at 37 is output as "a" at 33, which means "a@object\|0/12", not "a@object\|0/13" |
| typescript/class-comment/class-implements.ts | 1/1 | 80.92% | check: input comment "// comment" is missing from the output |
| typescript/class-comment/declare.ts | 1/1 | 66.67% | check: input comment "// extends b   // 2" is missing from the output |
| typescript/comments/mapped-types.ts | 1/1 | 80.00% | check: input comment "// commentA" is missing from the output |
| typescript/compiler/commentInNamespaceDeclarationWithIdentifierPathName.ts | 1/1 | 57.14% | check: input "namespace" at 1 is output as "namespace" at 1, which means "namespace@\|-1/2", not "namespace@\|-1/3" |
| typescript/conditional-types/comments.ts | 2/2 | 67.64% | check: input "any instanceof B\n  /**\n  * Comment\n  */\n    ? B \| C\n    : D" at 1337 is output as "any" at 1286, whic |
| typescript/conditional-types/conditional-types.ts | 2/2 | 100.00% | check: input "new" at 1298 is output as "new" at 1327, which means "new@\|-1/175", not "new@\|-1/174" |
| typescript/decorator-auto-accessors/decorator-auto-accessors-type-annotations.ts | 1/1 | 75.00% | check: input "prop2" at 68 is output as "prop2" at 68, which means "key:prop2@name\|0/8", not "prop2@\|0/8" |
| typescript/decorators/comments.ts | 1/1 | 60.00% | check: input "static" at 55 is output as "static" at 36, which means "key:static@name\|1/4", not "static@\|-1/4" |
| typescript/decorators/decorators-comments.ts | 1/1 | 88.57% | check: input "readonly" at 295 is output as "readonly" at 251, which means "key:readonly@name\|1/29", not "readonly@\|-1/2 |
| typescript/end-of-line/multiline.ts | 2/3 | 71.43% | check: input "\\\n" at 511 is output as "\\\r" at 486, which means "\\\r@\|3/35", not "\\\n@\|3/35" |
| typescript/import-export/empty-import.ts | 1/1 | 32.43% | check: output comment "// comment // comment" matches no input comment |
| typescript/interface/comments-generic.ts | 2/2 | 89.66% | check: input comment "// 2" is missing from the output |
| typescript/interface/long-type-parameters/long-type-parameters.ts | 2/2 | 75.65% | check: input comment "// always extends RectConfig" is missing from the output |
| typescript/interface/no-semi/14040.ts | 1/1 | 100.00% | check: the output has a syntax error at 712, which the input has not |
| typescript/interface/no-semi/18858.ts | 1/1 | 100.00% | check: the output has a syntax error at 406, which the input has not |
| typescript/interface2/comments-declare.ts | 1/1 | 88.89% | check: input comment "// 2" is missing from the output |
| typescript/interface2/comments.ts | 1/1 | 73.24% | check: input comment "// comment2" is missing from the output |
| typescript/interface2/comments-ts-and-flow/18216-mutiple-clauses.ts | 1/1 | 89.47% | check: input comment "// Comment" is missing from the output |
| typescript/interface2/comments-ts-and-flow/18216-type-parameters-mutiple-clauses.ts | 1/1 | 89.47% | check: input comment "// Comment" is missing from the output |
| typescript/interface2/comments-ts-and-flow/18216-type-parameters.ts | 1/1 | 42.86% | check: input comment "// Comment" is missing from the output |
| typescript/interface2/comments-ts-and-flow/18216.ts | 1/1 | 52.94% | check: input comment "// Comment" is missing from the output |
| typescript/mapped-type/break-mode/break-mode.ts | 1/1 | 96.30% | check: input "[" at 90 is output as "[" at 97, which means "[@\|-1/16", not "[@\|-1/15" |
| typescript/parentheses/yield.ts | 1/1 | 40.00% | check: input "yield" at 41 is output as "yield" at 42, which means "yield@\|-1/8", not "yield@\|-1/9" |
| typescript/type-parameters-arguments/19505.ts | 1/1 | 98.18% | check: input comment "// dangling comment" is missing from the output |
| typescript/union/consistent-with-flow/18647.ts | 1/1 | 75.00% | check: input "any instanceof B\n  /**\n  * Comment\n  */\n    ? B \| C\n    : D" at 139 is output as "any" at 147, which  |
| typescript/union/consistent-with-flow/union-last-comment.ts | 1/1 | 64.71% | check: output comment "// Comment2 // Final comment1" matches no input comment |

# Excluded

## cursor or range formatting (19)

- typescript/cursor/array-pattern.ts
- typescript/cursor/arrow-function-type.ts
- typescript/cursor/class-property.ts
- typescript/cursor/function-return-type.ts
- typescript/cursor/identifier-1.ts
- typescript/cursor/identifier-2.ts
- typescript/cursor/identifier-3.ts
- typescript/cursor/method-signature.ts
- typescript/cursor/property-signature.ts
- typescript/cursor/rest.ts
- typescript/range/export-assignment.ts
- typescript/range/issue-4926.ts
- typescript/range/issue-7148.ts
- jsx/cursor/after-last-jsx-text.js
- jsx/cursor/after-tag.js
- jsx/cursor/before-first-jsx-text.js
- jsx/cursor/before-tag.js
- jsx/cursor/in-jsx-text.js
- jsx/cursor/in-tag.js

## ignored syntax (not in the grammar or not the parser's) (26)

- typescript/angular-component-examples/15934-computed.component.ts
- typescript/angular-component-examples/15934.component.ts
- typescript/angular-component-examples/15969-computed.component.ts
- typescript/angular-component-examples/test.component.ts
- typescript/as/as-const-embedded.ts
- typescript/conformance/classes/constructorDeclarations/constructorParameters/readonlyReadonly.ts
- typescript/decorator-auto-accessors/decorator-auto-accessors-abstract-class.ts
- typescript/decorator-auto-accessors/decorator-auto-accessors-declare-class.ts
- typescript/decorator-auto-accessors/decorator-auto-accessors-mixed-modifiers.ts
- typescript/decorators-ts/angular.ts
- typescript/error-recovery/index-signature.ts
- typescript/error-recovery/jsdoc_only_types.ts
- typescript/multiparser-css/issue-6259.ts
- typescript/prettier-ignore/issue-14238.ts
- typescript/prettier-ignore/issue-16927.ts
- typescript/prettier-ignore/mapped-types.ts
- typescript/prettier-ignore/prettier-ignore-nested-unions.ts
- typescript/prettier-ignore/prettier-ignore-parenthesized-type.ts
- typescript/prettier-ignore/no-semi/prettier-ignore-parenthesized-type.ts
- typescript/top-level-await/test.cts
- typescript/top-level-await/test.mts
- typescript/top-level-await/test.ts
- typescript/top-level-await/test.tsx
- typescript/trailing-comma/invalid.ts
- jsx/template/styled-components.js
- jsx/top-level-await/test.jsx

## the spec expects the parser to reject it (31)

- typescript/_errors_/declare-getter.ts
- typescript/_errors_/declare-setter.ts
- typescript/_errors_/export-declare.ts
- typescript/_errors_/invalid-jsx-1.tsx
- typescript/_errors_/module-attributes-static.ts
- typescript/_errors_/newline-before-arrow.ts
- typescript/_errors_/value-of-abstract-property.ts
- typescript/_errors_/babel-ts/abstract.ts
- typescript/_errors_/babel-ts/classAbstractMethodWithImplementation.ts
- typescript/_errors_/babel-ts/declare-accessor.ts
- typescript/_errors_/babel-ts2/export-declare.ts
- typescript/_errors_/babel-ts2/multiline-declaration-abstract-class.ts
- typescript/_errors_/babel-ts2/multiline-declaration-interface.ts
- typescript/_errors_/babel-ts2/multiline-declaration-module.ts
- typescript/_errors_/babel-ts2/multiline-declaration-type.ts
- typescript/_errors_/babel-ts2/parenthesized-decorators-tagged-template.ts
- typescript/_errors_/babel-ts2/type-annotation-expr-statement.ts
- typescript/_errors_/babel-ts2/type-annotation-func.ts
- typescript/_errors_/babel-ts2/type-annotation-in-jsx.tsx
- typescript/_errors_/catch-clause-with-initializer/catch-clause-with-initializer.ts
- typescript/_errors_/import-reflection/valid-flow-default-import.mts
- typescript/_errors_/import-reflection/valid-ts-default-import.mts
- typescript/_errors_/invalid-typescript-decorators/decorator.ts
- typescript/_errors_/invalid-typescript-decorators/enums.ts
- typescript/_errors_/invalid-typescript-decorators/function.ts
- typescript/_errors_/invalid-typescript-decorators/interface.ts
- typescript/_errors_/invalid-typescript-decorators/issue-9102.ts
- typescript/_errors_/mapped-type/mapped-type.ts
- typescript/type-arguments-bit-shift-left-like/3.ts
- typescript/type-arguments-bit-shift-left-like/5.tsx
- jsx/comments/in-end-tag.js
