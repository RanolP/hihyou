kotlin compatibility: 591/753 (78.49%), 28 refused (ok:false), 11 excluded

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files, then the inputs of ktfmt's own tests: its cases/**/*.input files and KDocFormatterTest.kt's comments), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| comments.txt: Comments | 0/1 | 76.19% |
| source-files.txt: Multiple Imports On A Single Line | 0/1 | 50.00% |
| packages/syntechs/src/grammars/kotlin/corpus/Collections.kt | 0/1 | 94.91% |
| packages/syntechs/src/grammars/kotlin/corpus/Result.kt | 0/1 | 99.12% |
| packages/syntechs/src/grammars/kotlin/corpus/Delay.kt | 0/1 | 97.97% |
| packages/syntechs/src/grammars/kotlin/corpus/Transform.kt | 0/1 | 92.98% |
| packages/syntechs/src/grammars/kotlin/corpus/Okio.kt | 0/1 | 97.44% |
| packages/syntechs/src/grammars/kotlin/corpus/build.gradle.kts | 0/1 | 94.57% |
| ktfmt/format/annotation/exception.kt | 0/1 | 61.54% |
| ktfmt/format/annotation/expressions2.kt | 0/1 | 78.05% |
| ktfmt/format/annotation/functionTypes.kt | 0/1 | 60.00% |
| ktfmt/format/annotation/multipleAnnotations.kt | 0/1 | 85.71% |
| ktfmt/format/binary/associativity.kt | 0/1 | 72.73% |
| ktfmt/format/binary/binaryExpressionWithRanges.kt | 0/1 | 76.92% |
| ktfmt/format/binary/commentBeforeBinaryOperator.kt | 0/1 | 62.50% |
| ktfmt/format/binary/lineCommentBeforeOperator.kt | 0/1 | 62.50% |
| ktfmt/format/binary/longBinaryOperations.kt | 0/1 | 46.15% |
| ktfmt/format/binary/multiOperandChain.kt | 0/1 | 58.82% |
| ktfmt/format/call/anonymousFun.kt | 0/1 | 88.89% |
| ktfmt/format/call/anonymousFunWithReceiver.kt | 0/1 | 88.89% |
| ktfmt/format/call/arrayAccessInTheCallChain.kt | 0/1 | 63.64% |
| ktfmt/format/call/callArgsStickToFunctionName.kt | 0/1 | 60.00% |
| ktfmt/format/call/chainWithDereferences.kt | 0/1 | 50.00% |
| ktfmt/format/call/functionReference.kt | 0/1 | 88.00% |
| ktfmt/format/call/gh633.kt | 0/1 | 87.91% |
| ktfmt/format/call/namedArgsWithValueExpr.kt | 0/1 | 57.14% |
| ktfmt/format/call/nestedCalls.kts | 0/1 | 63.16% |
| ktfmt/format/call/trailingCommaInLambda.kt | 0/1 | 45.45% |
| ktfmt/format/call/trailingCommasInCalls.kt | 0/1 | 75.00% |
| ktfmt/format/class/constructors.kt | 0/1 | 77.97% |
| ktfmt/format/class/emptyEnumWithSemicolon2.kt | 0/1 | 0.00% |
| ktfmt/format/class/emptyEnumWithSemicolon3.kt | 0/1 | 25.00% |
| ktfmt/format/class/emptyEnumWithSemicolon6.kt | 0/1 | 50.00% |
| ktfmt/format/class/expectEnum.kt | 0/1 | 0.00% |
| ktfmt/format/class/functionalInterface.kt | 0/1 | 57.14% |
| ktfmt/format/class/functionalInterfaceWithTypeParams.kt | 0/1 | 66.67% |
| ktfmt/format/class/lineBreakOnTypeSpecifier.kt | 0/1 | 57.14% |
| ktfmt/format/class/primaryConstructor3.kt | 0/1 | 86.96% |
| ktfmt/format/class/primaryConstructorKDoc.kt | 0/1 | 85.71% |
| ktfmt/format/class/secondaryConstructor2.kt | 0/1 | 85.71% |
| ktfmt/format/class/secondaryConstructorDelegate2.kt | 0/1 | 52.63% |
| ktfmt/format/class/trailingCommaInExplicitConstructors.kt | 0/1 | 73.68% |
| ktfmt/format/comment/blockComment.kt | 0/1 | 62.50% |
| ktfmt/format/comment/shebang.kts | 0/1 | 88.89% |
| ktfmt/format/function/assignmentWithScopeFunction.kt | 0/1 | 44.19% |
| ktfmt/format/function/trailingCommasInDefinitions.kt | 0/1 | 90.57% |
| ktfmt/format/if/comment.kt | 0/1 | 61.54% |
| ktfmt/format/if/expr.kt | 0/1 | 91.67% |
| ktfmt/format/import/importList.kt | 0/1 | 37.50% |
| ktfmt/format/import/importsInKDoc.kt | 0/1 | 94.55% |
| ktfmt/format/import/importsWithTrailingExprs.kt | 0/1 | 66.67% |
| ktfmt/format/import/importsWithTrailingExprs2.kt | 0/1 | 66.67% |
| ktfmt/format/import/importsWithTrailingExprs3.kt | 0/1 | 66.67% |
| ktfmt/format/import/keepUnusedImports.kt | 0/1 | 85.71% |
| ktfmt/format/import/usedImportsFromSamePackage.kt | 0/1 | 94.12% |
| ktfmt/format/lambda/lambdaArg.kt | 0/1 | 66.67% |
| ktfmt/format/lambda/lambdaWithFullType.kt | 0/1 | 44.44% |
| ktfmt/format/misc/addingTrailingCommaOnMaxWidth.kt | 0/1 | 75.00% |
| ktfmt/format/misc/addingTrailingCommaWhenBreakingParameterList2.kt | 0/1 | 88.00% |
| ktfmt/format/misc/combination.kt | 0/1 | 97.73% |
| ktfmt/format/misc/commentStability.kt | 0/1 | 70.59% |
| ktfmt/format/misc/commentStability2.kt | 0/1 | 0.00% |
| ktfmt/format/misc/commentStability3-2.kts | 0/1 | 93.02% |
| ktfmt/format/misc/commentStability3.kt | 0/1 | 92.68% |
| ktfmt/format/misc/commentStability4.kt | 0/1 | 76.92% |
| ktfmt/format/misc/commentsRepectMaxWidth.kt | 0/1 | 66.67% |
| ktfmt/format/misc/contextParameters.kt | 0/1 | 61.54% |
| ktfmt/format/misc/contextReceivers.kt | 0/1 | 64.00% |
| ktfmt/format/misc/explicitBackingField.kt | 0/1 | 71.43% |
| ktfmt/format/misc/explicitBackingFieldWithoutType.kt | 0/1 | 75.00% |
| ktfmt/format/misc/explicitBackingWithPrivateSet.kt | 0/1 | 80.00% |
| ktfmt/format/misc/gh243.kt | 0/1 | 69.57% |
| ktfmt/format/misc/labels.kt | 0/1 | 78.79% |
| ktfmt/format/misc/redundantSemicolons.kt | 0/1 | 95.65% |
| ktfmt/format/misc/semicolonsBetweenCalls.kt | 0/1 | 73.42% |
| ktfmt/format/misc/semicolonsInEmptyBodies.kt | 0/1 | 61.54% |
| ktfmt/format/misc/trailingCommas.kt | 0/1 | 22.81% |
| ktfmt/format/misc/unaryPostfix.kt | 0/1 | 90.00% |
| ktfmt/format/misc/unaryPrefix.kt | 0/1 | 57.89% |
| ktfmt/format/property/backingFieldWithChainedScopingFunction.kt | 0/1 | 28.57% |
| ktfmt/format/property/backingFieldWithChainedScopingFunction2.kt | 0/1 | 71.43% |
| ktfmt/format/property/backingFieldWithChainedScopingFunction3.kt | 0/1 | 40.00% |
| ktfmt/format/property/trailingCommasInProperties.kt | 0/1 | 72.73% |
| ktfmt/format/string/commentAfterMultilineString4.kt | 0/1 | 35.29% |
| ktfmt/format/string/multiDollarString.kt | 0/1 | 33.33% |
| ktfmt/format/string/multilineStringLiterals.kt | 0/1 | 92.86% |
| ktfmt/format/string/multilineStringsWithTemplateExpressions.kt | 0/1 | 96.30% |
| ktfmt/format/string/multilineStringsWithTemplateExpressions2.kt | 0/1 | 40.00% |
| ktfmt/format/string/nestedMultilineString2.kt | 0/1 | 96.97% |
| ktfmt/format/string/trimMarginAndTrimIndent.kts | 0/1 | 91.67% |
| ktfmt/format/string/whitespaces.kt | 0/1 | 78.95% |
| ktfmt/format/type/castsWithBreaks.kt | 0/1 | 67.86% |
| ktfmt/format/type/classExpression.kt | 0/1 | 66.67% |
| ktfmt/format/type/generics2.kt | 0/1 | 33.33% |
| ktfmt/format/type/generics3.kt | 0/1 | 30.00% |
| ktfmt/format/type/intersections.kt | 0/1 | 75.00% |
| ktfmt/format/type/nestedQualifiedTypes.kt | 0/1 | 40.00% |
| ktfmt/format/type/trailingCommasInFunctionTypes.kt | 0/1 | 60.00% |
| ktfmt/format/when/guards.kt | 0/1 | 58.33% |
| ktfmt/format/when/isAndIn.kt | 0/1 | 53.85% |
| ktfmt/format/when/lineBreaks.kt | 0/1 | 44.00% |
| ktfmt/format/when/multipleConditions.kt | 0/1 | 76.92% |
| ktfmt/format/when/newLinesBetweenClauses.kt | 0/1 | 72.00% |
| ktfmt/format/when/whenWithSubject.kt | 0/1 | 78.26% |
| ktfmt/google/anonymousFunction.kt | 0/1 | 85.71% |
| ktfmt/google/anonymousFunctionWithReceiver.kt | 0/1 | 85.71% |
| ktfmt/google/basic.kt | 0/1 | 97.62% |
| ktfmt/google/casts.kt | 0/1 | 42.86% |
| ktfmt/google/classTypeParams.kt | 0/1 | 63.29% |
| ktfmt/google/comments.kt | 0/1 | 55.56% |
| ktfmt/google/forcedBreaksInFunCalls.kt | 0/1 | 69.44% |
| ktfmt/google/forwardPropagationOfBreaks3.kt | 0/1 | 66.67% |
| ktfmt/google/fqNestedTypes.kt | 0/1 | 38.10% |
| ktfmt/google/ifWithElse.kt | 0/1 | 90.00% |
| ktfmt/google/ifWithMaxWidthCondition.kt | 0/1 | 47.06% |
| ktfmt/google/longBinaryOps.kt | 0/1 | 41.67% |
| ktfmt/google/longFunctionTypeWrapping.kt | 0/1 | 23.53% |
| ktfmt/google/multiLineStringAsFunctionParam.kt | 0/1 | 91.67% |
| ktfmt/google/namedArgumentsWithValueExpression.kt | 0/1 | 47.06% |
| ktfmt/google/secondaryConstructorNoArgs.kt | 0/1 | 47.06% |
| ktfmt/google/singleLambdaArgument.kt | 0/1 | 62.50% |
| ktfmt/google/trailingCommasAlwaysRemoved.kt | 0/1 | 52.17% |
| ktfmt/google/trailingCommasSingleElementLists.kt | 0/1 | 58.54% |
| ktfmt/google/trailingLambdaAfterArgumentBreak.kt | 0/1 | 92.31% |
| ktfmt/google/when.kt | 0/1 | 36.00% |
| ktfmt/google/whenWithMaxWidthCondition.kt | 0/1 | 42.11% |
| ktfmt/google/whileMaxWidthCondition.kt | 0/1 | 47.06% |
| ktfmt/kotlinlang/nestedCalls.kts | 0/1 | 63.16% |
| ktfmt/new_codestyle/annotation/AnnotationsEverywhere.kt | 0/1 | 93.75% |
| ktfmt/new_codestyle/annotation/AnnotationsOnParameters.kt | 0/1 | 82.61% |
| ktfmt/new_codestyle/annotation/AnnotationsOnTypes.kt | 0/1 | 93.20% |
| ktfmt/new_codestyle/annotation/DeclarationAnnotations.kt | 0/1 | 93.62% |
| ktfmt/new_codestyle/annotation/UseSiteTargets.kt | 0/1 | 90.48% |
| ktfmt/new_codestyle/calls/gh633.kt | 0/1 | 87.91% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| ktfmt/format/annotation/collectionLiterals.kt | 1/1 | 82.50% | formatter-error: no rule: collection_literal at 58 |
| ktfmt/format/annotation/noNewLineAfterAnnotations.kt | 1/1 | 82.67% | check: input comment "//" is missing from the output |
| ktfmt/format/class/emptyCompanionObject.kt | 1/1 | 53.85% | formatter-error: no rule: anonymous_initializer at 52 |
| ktfmt/format/class/initBlock.kt | 1/1 | 40.00% | formatter-error: no rule: anonymous_initializer at 14 |
| ktfmt/format/class/interfaceDelegation.kt | 1/1 | 100.00% | formatter-error: no rule: explicit_delegation at 32 |
| ktfmt/format/class/objectExpr.kt | 1/1 | 66.67% | formatter-error: no rule: object_literal at 24 |
| ktfmt/format/class/objectExpr2.kt | 1/1 | 66.67% | formatter-error: no rule: object_literal at 25 |
| ktfmt/format/class/trailingCommentAfterMethod.kt | 1/1 | 91.11% | check: output comment "// Hanging after fn // Trailing after fn" matches no input comment |
| ktfmt/format/function/varargs.kt | 1/1 | 50.00% | formatter-error: no rule: spread_expression at 38 |
| ktfmt/format/if/blocks.kt | 1/1 | 18.18% | formatter-error: no rule: do_while_statement at 34 |
| ktfmt/format/lambda/lambdaWithMultipleStatementsAndComments2.kt | 1/1 | 65.00% | check: input comment "/* no-op */" is missing from the output |
| ktfmt/format/lambda/lambdaWithOnlyComments.kt | 1/1 | 0.00% | check: input comment "/* do nothing */" is missing from the output |
| ktfmt/format/lambda/lambdaWithOnlyComments2.kt | 1/1 | 22.22% | check: input comment "/* do nothing */" is missing from the output |
| ktfmt/format/lambda/lambdaWithOptionalArrow.kt | 1/1 | 83.33% | check: input "->" at 10 is output as "}" at 9, which means "}", not "->" |
| ktfmt/format/lambda/lastParameterWithComment.kt | 1/1 | 64.29% | check: input comment "// no-op" is missing from the output |
| ktfmt/format/lambda/lastParameterWithComment2.kt | 1/1 | 80.95% | check: input comment "/* no-op */" is missing from the output |
| ktfmt/format/misc/doWhile.kt | 1/1 | 42.86% | formatter-error: no rule: do_while_statement at 18 |
| ktfmt/format/property/propertiesWithAccessors.kt | 1/1 | 27.78% | formatter-error: no rule: parameter_with_optional_type at 95 |
| ktfmt/format/property/propertiesWithAccessors2.kt | 1/1 | 44.44% | formatter-error: no rule: parameter_with_optional_type at 119 |
| ktfmt/format/type/compondBoundOnClassDelegate.kt | 1/1 | 100.00% | formatter-error: no rule: explicit_delegation at 17 |
| ktfmt/google/arrayLiteralInAnnotation.kt | 1/1 | 36.11% | formatter-error: no rule: collection_literal at 38 |
| ktfmt/google/comments2.kt | 1/1 | 30.00% | formatter-error: no rule: collection_literal at 38 |
| ktfmt/google/missingTrailingCommas.kt | 1/1 | 19.18% | formatter-error: no rule: collection_literal at 334 |
| ktfmt/google/redundantTrailingCommas.kt | 1/1 | 50.00% | formatter-error: no rule: collection_literal at 120 |
| ktfmt/google/trailingCommasNotAdded.kt | 1/1 | 21.74% | formatter-error: no rule: collection_literal at 112 |
| ktfmt/new_codestyle/annotation/AnnotationArguments.kt | 1/1 | 100.00% | formatter-error: no rule: collection_literal at 26 |
| ktfmt/new_codestyle/annotation/AnnotationOnExpression.kt | 1/1 | 85.48% | formatter-error: no rule: object_literal at 808 |
| ktfmt/new_codestyle/annotation/AnnotationOnExpressionFullWidth.kt | 1/1 | 83.20% | formatter-error: no rule: object_literal at 813 |

# Excluded

## ktfmt rejects the input (11)

- expressions.txt: Safe Navigation
- expressions.txt: Less than for comparison
- statements.txt: Getters
- types.txt: Type constructor
- types.txt: Type constructor with trailing comma
- types.txt: Ampersand type
- types.txt: Ampersand type with modifiers
- ktfmt/format/annotation/arrayOfAnnotationsOnExpression.kt
- ktfmt/format/annotation/desctucturingDeclaration.kt
- ktfmt/format/misc/nameBasedDestructuringDeclaration.kt
- ktfmt/format/misc/twoModifierLists.kt
