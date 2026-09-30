ts@oxfmt compatibility: 604/632 (95.57%), 0 refused (ok:false), 97 excluded

Fixtures: those of the ts target, every option set, expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults. A fixture oxfmt rejects under any of its option sets is excluded.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| typescript/as/as-const/as-const.ts | 0/1 | 66.67% |
| typescript/as/comments/17407.ts | 0/1 | 47.06% |
| typescript/as/comments/18160.ts | 0/1 | 54.21% |
| typescript/call/callee-comments.ts | 0/1 | 75.00% |
| typescript/cast/18406.ts | 0/1 | 84.21% |
| typescript/class-comment/class-implements.ts | 0/1 | 93.33% |
| typescript/class-comment/declare.ts | 0/1 | 72.00% |
| typescript/comments/method_types.ts | 0/1 | 82.05% |
| typescript/comments/type-parameters.ts | 0/1 | 81.82% |
| typescript/comments/first-argument/first-argument.ts | 0/1 | 81.16% |
| typescript/interface/comments-generic.ts | 0/2 | 91.80% |
| typescript/interface2/comments-declare.ts | 0/1 | 60.00% |
| typescript/interface2/comments.ts | 0/1 | 65.79% |
| typescript/intersection/intersection-parens.ts | 1/3 | 99.29% |
| typescript/intersection/consistent-with-flow/intersection-parens.ts | 0/1 | 97.67% |
| typescript/intersection/consistent-with-flow/single-member.ts | 0/1 | 96.91% |
| typescript/property-signature/consistent-with-flow/comments.ts | 0/1 | 80.00% |
| typescript/satisfies-operators/comments-unstable.ts | 0/2 | 61.54% |
| typescript/template-literals/member-expression.ts | 0/1 | 65.12% |
| typescript/type-parameters-arguments/18604.ts | 0/1 | 60.00% |
| typescript/type-parameters-arguments/19505.ts | 0/1 | 61.54% |
| typescript/type-parameters-arguments/issue-6858.ts | 0/1 | 60.61% |
| typescript/union/union-parens.ts | 0/1 | 97.67% |
| typescript/union/comments/18379.ts | 0/1 | 92.31% |
| typescript/union/consistent-with-flow/conditional.ts | 0/1 | 54.55% |
| typescript/union/consistent-with-flow/leading-comments.ts | 0/1 | 94.29% |
| typescript/union/consistent-with-flow/prettier-ignore.ts | 0/1 | 88.00% |
| typescript/union/consistent-with-flow/single-type.ts | 0/1 | 97.50% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

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

## oxfmt 0.70.0 rejects it: 'const' modifier can only appear on a type parameter of a function, method or class (1)

- typescript/type-parameters-arguments/const.ts

## oxfmt 0.70.0 rejects it: 'private' modifier cannot be used with 'abstract' modifier. (3)

- typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractMixedWithModifiers.ts
- typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractProperties.ts
- typescript/custom/abstract/abstractProperties.ts

## oxfmt 0.70.0 rejects it: 'public' modifier must precede 'readonly' modifier. (1)

- typescript/conformance/classes/constructorDeclarations/constructorParameters/readonlyInConstructorParameters.ts

## oxfmt 0.70.0 rejects it: `await` is only allowed within async functions and at the top levels of modules (1)

- typescript/namespace/invalid-await.ts

## oxfmt 0.70.0 rejects it: A 'declare' modifier cannot be used in an already ambient context. (1)

- typescript/interface2/module.ts

## oxfmt 0.70.0 rejects it: A required parameter cannot follow an optional parameter. (1)

- typescript/conformance/types/functions/functionOverloadErrorsSyntax.ts

## oxfmt 0.70.0 rejects it: Declarations with definite assignment assertions must also have type annotations. (1)

- typescript/definite/without-annotation.ts

## oxfmt 0.70.0 rejects it: Declarations with initializers cannot also have definite assignment assertions. (1)

- typescript/definite/definite.ts

## oxfmt 0.70.0 rejects it: Failed to parse configuration: Unsupported option: `experimentalTernaries` (6)

- typescript/conditional-types/comments.ts
- typescript/conditional-types/conditional-types.ts
- typescript/conditional-types/infer-type.ts
- typescript/conditional-types/nested-in-condition.ts
- typescript/conditional-types/new-ternary-spec.ts
- typescript/conditional-types/parentheses.ts

## oxfmt 0.70.0 rejects it: Initializers are not allowed in ambient contexts. (4)

- typescript/class/declare-readonly-field-initializer-w-annotation.ts
- typescript/declare/declare-class-fields.ts
- typescript/declare/declare-module.ts
- typescript/declare/declare-namespace.ts

## oxfmt 0.70.0 rejects it: Only ambient modules can use quoted names. (1)

- typescript/module/keyword.ts

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
