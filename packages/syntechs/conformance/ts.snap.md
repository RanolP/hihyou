ts compatibility: 617/653 (94.49%), 11 refused (ok:false), 76 excluded

Other formatters on the same fixtures, fixtures passed:

- oxfmt 0.70.0: 490/653 (75.04%)

Fixtures: prettier 3.9.9 tests/format/{typescript,jsx} (recursive), every spec call listing parser `typescript` or `babel-ts` or `oxc-ts`, expected output from its __snapshots__.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| typescript/argument-expansion/arrow-with-return-type.ts | 0/1 | 77.78% |
| typescript/arrow/comments/issue-11100.ts | 0/1 | 56.52% |
| typescript/as/comments/18160.ts | 0/1 | 81.25% |
| typescript/call/callee-comments.ts | 0/1 | 74.36% |
| typescript/comments/11662.ts | 0/1 | 80.00% |
| typescript/comments/16065.ts | 0/1 | 81.82% |
| typescript/comments/16889.ts | 0/1 | 97.39% |
| typescript/comments/method_types.ts | 0/1 | 82.05% |
| typescript/compiler/indexSignatureWithInitializer.ts | 0/1 | 87.50% |
| typescript/conditional-types/parentheses.ts | 0/2 | 86.00% |
| typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractWithInterface.ts | 0/1 | 0.00% |
| typescript/conformance/types/moduleDeclaration/kind-detection.ts | 0/1 | 0.00% |
| typescript/custom/abstract/abstractNewlineHandling.ts | 0/1 | 86.96% |
| typescript/definite/without-annotation.ts | 0/1 | 91.67% |
| typescript/import-require/type-imports.ts | 0/1 | 56.00% |
| typescript/instantiation-expression/inferface-asi.ts | 0/1 | 36.36% |
| typescript/interface/ignore.ts | 0/2 | 86.79% |
| typescript/last-argument-expansion/decorated-function.tsx | 0/1 | 90.91% |
| typescript/non-null/braces.ts | 0/1 | 94.12% |
| typescript/property-signature/consistent-with-flow/comments.ts | 0/1 | 80.00% |
| typescript/template-literals/member-expression.ts | 0/1 | 57.14% |
| typescript/trailing-comma/trailing.ts | 2/3 | 97.78% |
| typescript/type-parameters-arguments/long-function-arg.ts | 0/1 | 18.18% |
| typescript/union/consistent-with-flow/prettier-ignore.ts | 0/1 | 60.00% |
| jsx/jsx/html_escape.js | 2/4 | 66.67% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| typescript/chain-expression/tagged-template-literals.ts | 1/1 | 72.31% | check: input "a" at 37 is output as "a" at 33, which means "a@object\|0/12", not "a@object\|0/13" |
| typescript/conditional-types/comments.ts | 2/2 | 94.21% | check: input "any instanceof B\n  /**\n  * Comment\n  */\n    ? B \| C\n    : D" at 1337 is output as "any" at 1364, whic |
| typescript/conditional-types/conditional-types.ts | 2/2 | 100.00% | check: input "new" at 1298 is output as "new" at 1327, which means "new@\|-1/175", not "new@\|-1/174" |
| typescript/end-of-line/multiline.ts | 2/3 | 100.00% | check: input "\\\n" at 511 is output as "\\\r" at 512, which means "\\\r@\|3/35", not "\\\n@\|3/35" |
| typescript/import-export/empty-import.ts | 1/1 | 64.86% | check: output comment "// comment } from \"a\";" matches no input comment |
| typescript/interface/long-type-parameters/long-type-parameters.ts | 2/2 | 75.65% | check: input comment "// always extends RectConfig" is missing from the output |
| typescript/interface/no-semi/14040.ts | 1/1 | 100.00% | check: the output has a syntax error at 712, which the input has not |
| typescript/interface/no-semi/18858.ts | 1/1 | 100.00% | check: the output has a syntax error at 406, which the input has not |
| typescript/mapped-type/issue-11098.ts | 1/1 | 93.07% | check: input "[" at 520 is output as "}" at 509, which means "}@\|-1/43", not "[@\|-1/45" |
| typescript/mapped-type/break-mode/break-mode.ts | 1/1 | 96.30% | check: input "[" at 90 is output as "[" at 97, which means "[@\|-1/16", not "[@\|-1/15" |
| typescript/union/consistent-with-flow/18647.ts | 1/1 | 75.00% | check: input "any instanceof B\n  /**\n  * Comment\n  */\n    ? B \| C\n    : D" at 139 is output as "any" at 147, which  |

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
