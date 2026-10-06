ts@oxfmt compatibility: 669/669 (100.00%), 0 refused (ok:false), 67 excluded

Fixtures: prettier 3.9.9 tests/format/{typescript,jsx} (recursive), every spec call listing parser `typescript` or `babel-ts` or `oxc-ts`, with the option sets it declares; expected output from oxfmt 0.70.0 run on each with that option set over prettier's defaults, cursor and range placeholders stripped. Every fixture counts, the ones prettier's own harness skips (its ignore list, its expected parse errors, its placeholders) included; a run is excluded only when oxfmt rejects it or does not keep its own output, and a fixture only when none of its runs is left or it is written in a language syntechs leaves out (SCSS, Less, Handlebars, postcss-conditionals, Angular).

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## oxfmt 0.70.0 is not idempotent on it (7)

- typescript/as/comments/17407.ts
- typescript/call/callee-comments.ts
- typescript/method-chain/object/issue-17239.ts {}
- typescript/prettier-ignore/issue-14238.ts
- typescript/prettier-ignore/mapped-types.ts
- jsx/comments/in-attributes.js
- jsx/spread/child.js

## oxfmt 0.70.0 rejects it: 'accessor' modifier cannot be used with 'declare' modifier. (1)

- typescript/decorator-auto-accessors/decorator-auto-accessors-abstract-class.ts

## oxfmt 0.70.0 rejects it: 'const' modifier can only appear on a type parameter of a function, method or class (1)

- typescript/type-parameters-arguments/const.ts

## oxfmt 0.70.0 rejects it: 'declare' modifier cannot be used here. (3)

- typescript/_errors_/declare-getter.ts
- typescript/_errors_/declare-setter.ts
- typescript/_errors_/babel-ts/declare-accessor.ts

## oxfmt 0.70.0 rejects it: 'private' modifier cannot be used with 'abstract' modifier. (3)

- typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractMixedWithModifiers.ts
- typescript/conformance/classes/classDeclarations/classAbstractKeyword/classAbstractProperties.ts
- typescript/custom/abstract/abstractProperties.ts

## oxfmt 0.70.0 rejects it: 'public' modifier must precede 'readonly' modifier. (1)

- typescript/conformance/classes/constructorDeclarations/constructorParameters/readonlyInConstructorParameters.ts

## oxfmt 0.70.0 rejects it: 'readonly' modifier already seen. (1)

- typescript/conformance/classes/constructorDeclarations/constructorParameters/readonlyReadonly.ts

## oxfmt 0.70.0 rejects it: `await` is only allowed within async functions and at the top levels of modules (1)

- typescript/namespace/invalid-await.ts

## oxfmt 0.70.0 rejects it: A 'declare' modifier cannot be used in an already ambient context. (1)

- typescript/interface2/module.ts

## oxfmt 0.70.0 rejects it: A required parameter cannot follow an optional parameter. (1)

- typescript/conformance/types/functions/functionOverloadErrorsSyntax.ts

## oxfmt 0.70.0 rejects it: A rest parameter or binding pattern may not have a trailing comma. (1)

- typescript/trailing-comma/invalid.ts

## oxfmt 0.70.0 rejects it: An accessibility modifier cannot be used with a private identifier. (1)

- typescript/decorator-auto-accessors/decorator-auto-accessors-mixed-modifiers.ts

## oxfmt 0.70.0 rejects it: An index signature must have a type annotation. (1)

- typescript/error-recovery/index-signature.ts

## oxfmt 0.70.0 rejects it: Declarations with definite assignment assertions must also have type annotations. (1)

- typescript/definite/without-annotation.ts

## oxfmt 0.70.0 rejects it: Declarations with initializers cannot also have definite assignment assertions. (1)

- typescript/definite/definite.ts

## oxfmt 0.70.0 rejects it: Expected `,` or `)` but found `:` (1)

- typescript/_errors_/babel-ts2/type-annotation-func.ts

## oxfmt 0.70.0 rejects it: Expected `,` or `]` but found `:` (1)

- typescript/_errors_/babel-ts2/type-annotation-in-jsx.tsx

## oxfmt 0.70.0 rejects it: Expected `)` but found `=` (1)

- typescript/_errors_/catch-clause-with-initializer/catch-clause-with-initializer.ts

## oxfmt 0.70.0 rejects it: Expected `{` but found `type` (1)

- typescript/_errors_/module-attributes-static.ts

## oxfmt 0.70.0 rejects it: Expected `}` but found `Identifier` (1)

- typescript/_errors_/mapped-type/mapped-type.ts

## oxfmt 0.70.0 rejects it: Expected `=>` but found ` (1)

- typescript/_errors_/babel-ts2/type-annotation-expr-statement.ts

## oxfmt 0.70.0 rejects it: Expected `from` but found `Identifier` (2)

- typescript/_errors_/import-reflection/valid-flow-default-import.mts
- typescript/_errors_/import-reflection/valid-ts-default-import.mts

## oxfmt 0.70.0 rejects it: Expected a semicolon or an implicit semicolon after a statement, but found none (4)

- typescript/_errors_/babel-ts2/multiline-declaration-abstract-class.ts
- typescript/_errors_/babel-ts2/multiline-declaration-interface.ts
- typescript/_errors_/babel-ts2/multiline-declaration-module.ts
- typescript/_errors_/babel-ts2/multiline-declaration-type.ts

## oxfmt 0.70.0 rejects it: Failed to parse configuration: Unsupported option: `experimentalTernaries` (6)

- typescript/conditional-types/comments.ts {"experimentalTernaries":true}
- typescript/conditional-types/conditional-types.ts {"experimentalTernaries":true}
- typescript/conditional-types/infer-type.ts {"experimentalTernaries":true}
- typescript/conditional-types/nested-in-condition.ts {"experimentalTernaries":true}
- typescript/conditional-types/new-ternary-spec.ts {"experimentalTernaries":true}
- typescript/conditional-types/parentheses.ts {"experimentalTernaries":true}

## oxfmt 0.70.0 rejects it: Initializers are not allowed in ambient contexts. (5)

- typescript/class/declare-readonly-field-initializer-w-annotation.ts
- typescript/declare/declare-class-fields.ts
- typescript/declare/declare-module.ts
- typescript/declare/declare-namespace.ts
- typescript/decorator-auto-accessors/decorator-auto-accessors-declare-class.ts

## oxfmt 0.70.0 rejects it: Line terminator not permitted before arrow (1)

- typescript/_errors_/newline-before-arrow.ts

## oxfmt 0.70.0 rejects it: Method 'foo' cannot have an implementation because it is marked abstract. (2)

- typescript/_errors_/babel-ts/abstract.ts
- typescript/_errors_/babel-ts/classAbstractMethodWithImplementation.ts

## oxfmt 0.70.0 rejects it: Only ambient modules can use quoted names. (1)

- typescript/module/keyword.ts

## oxfmt 0.70.0 rejects it: Property 'prop' cannot have an initializer because it is marked abstract. (1)

- typescript/_errors_/value-of-abstract-property.ts

## oxfmt 0.70.0 rejects it: Unexpected token (8)

- typescript/_errors_/export-declare.ts
- typescript/_errors_/babel-ts2/export-declare.ts
- typescript/_errors_/invalid-typescript-decorators/decorator.ts
- typescript/_errors_/invalid-typescript-decorators/enums.ts
- typescript/_errors_/invalid-typescript-decorators/function.ts
- typescript/_errors_/invalid-typescript-decorators/interface.ts
- typescript/_errors_/invalid-typescript-decorators/issue-9102.ts
- typescript/error-recovery/jsdoc_only_types.ts

## oxfmt 0.70.0 rejects it: Unexpected token. Did you mean `{'>'}` or `&gt (1)

- typescript/_errors_/invalid-jsx-1.tsx

## written in Angular, a language syntechs leaves out (5)

- typescript/angular-component-examples/15934-computed.component.ts
- typescript/angular-component-examples/15934.component.ts
- typescript/angular-component-examples/15969-computed.component.ts
- typescript/angular-component-examples/test.component.ts
- typescript/decorators-ts/angular.ts
