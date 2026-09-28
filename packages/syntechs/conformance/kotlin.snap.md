kotlin compatibility: 362/753 (48.07%), 55 refused (ok:false), 11 excluded

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files, then the inputs of ktfmt's own tests: its cases/**/*.input files and KDocFormatterTest.kt's comments), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| annotations.txt: Multi-annotations | 0/1 | 0.00% |
| comments.txt: Comments | 0/1 | 76.19% |
| newlines.txt: Else after newline | 0/1 | 0.00% |
| source-files.txt: File annotations | 0/1 | 50.00% |
| source-files.txt: Multiple file annotations | 0/1 | 0.00% |
| source-files.txt: Imports | 0/1 | 54.55% |
| source-files.txt: Multiple Imports On A Single Line | 0/1 | 0.00% |
| packages\syntechs\src\grammars\kotlin\corpus\tree-sitter-kotlin\Logger.kt | 0/1 | 97.87% |
| packages\syntechs\src\grammars\kotlin\corpus\Collections.kt | 0/1 | 92.93% |
| packages\syntechs\src\grammars\kotlin\corpus\Result.kt | 0/1 | 94.78% |
| packages\syntechs\src\grammars\kotlin\corpus\Delay.kt | 0/1 | 92.17% |
| packages\syntechs\src\grammars\kotlin\corpus\Transform.kt | 0/1 | 1.26% |
| packages\syntechs\src\grammars\kotlin\corpus\Okio.kt | 0/1 | 95.48% |
| packages\syntechs\src\grammars\kotlin\corpus\build.gradle.kts | 0/1 | 89.59% |
| ktfmt/format/annotation/annotationOnProperty.kt | 0/1 | 66.67% |
| ktfmt/format/annotation/arrayOfAnnotations.kt | 0/1 | 57.14% |
| ktfmt/format/annotation/arrayOfAnnotationsWithUseSite.kt | 0/1 | 57.14% |
| ktfmt/format/annotation/basic.kt | 0/1 | 50.00% |
| ktfmt/format/annotation/exception.kt | 0/1 | 0.00% |
| ktfmt/format/annotation/expressions.kt | 0/1 | 52.63% |
| ktfmt/format/annotation/functionDeclarations.kt | 0/1 | 62.50% |
| ktfmt/format/annotation/return.kt | 0/1 | 57.14% |
| ktfmt/format/binary/associativity.kt | 0/1 | 72.73% |
| ktfmt/format/binary/binaryExpressionWithRanges.kt | 0/1 | 76.92% |
| ktfmt/format/binary/commentBeforeBinaryOperator.kt | 0/1 | 62.50% |
| ktfmt/format/binary/elvisAfterCallChain.kt | 0/1 | 53.33% |
| ktfmt/format/binary/lineCommentBeforeOperator.kt | 0/1 | 62.50% |
| ktfmt/format/binary/longBinaryOperations.kt | 0/1 | 46.15% |
| ktfmt/format/binary/multiOperandChain.kt | 0/1 | 58.82% |
| ktfmt/format/call/anonymousFun.kt | 0/1 | 88.89% |
| ktfmt/format/call/anonymousFunWithReceiver.kt | 0/1 | 88.89% |
| ktfmt/format/call/arrayAccessInTheCallChain.kt | 0/1 | 66.67% |
| ktfmt/format/call/bracketsAreNotBreaking.kt | 0/1 | 52.63% |
| ktfmt/format/call/breakBeforeLambda.kt | 0/1 | 28.57% |
| ktfmt/format/call/callArgsStickToFunctionName.kt | 0/1 | 60.00% |
| ktfmt/format/call/callChain.kt | 0/1 | 24.39% |
| ktfmt/format/call/callChainOnTheSameLineBeforeLambda.kt | 0/1 | 86.67% |
| ktfmt/format/call/chainWithBlockAfterDereferencing.kt | 0/1 | 66.67% |
| ktfmt/format/call/chainWithBlockAfterDereferencing2.kt | 0/1 | 66.67% |
| ktfmt/format/call/chainWithDereferences.kt | 0/1 | 50.00% |
| ktfmt/format/call/commentsInCallChain.kt | 0/1 | 47.06% |
| ktfmt/format/call/dereferenceChainWithInvocation.kts | 0/1 | 40.00% |
| ktfmt/format/call/dereferenceChainWithMultiLineLambdaInMiddle.kts | 0/1 | 30.00% |
| ktfmt/format/call/dereferenceChainWithMultiLineLambdaInMiddle2.kts | 0/1 | 22.22% |
| ktfmt/format/call/dereferenceLambdaAndInvocation.kts | 0/1 | 37.50% |
| ktfmt/format/call/dereferenceLambdaAndTwoInvocations.kts | 0/1 | 20.00% |
| ktfmt/format/call/dirrefentIndentations.kt | 0/1 | 78.05% |
| ktfmt/format/call/forwardPropagationInCallExpr.kt | 0/1 | 57.14% |
| ktfmt/format/call/forwardPropagationInCallExpr2.kt | 0/1 | 45.45% |
| ktfmt/format/call/functionReference.kt | 0/1 | 81.48% |
| ktfmt/format/call/gh589.kt | 0/1 | 47.69% |
| ktfmt/format/call/gh633-2.kt | 0/1 | 43.59% |
| ktfmt/format/call/multiLineArgumentsStartWithLambda.kts | 0/1 | 58.82% |
| ktfmt/format/call/multiLineArgumentsWithPrefixAndTrail.kts | 0/1 | 44.44% |
| ktfmt/format/call/multiLineArgumentsWithSuper.kts | 0/1 | 58.82% |
| ktfmt/format/call/multiLineArgumentsWithTrail.kts | 0/1 | 44.44% |
| ktfmt/format/call/multiLineArgumentsWithTrailInvocation.kts | 0/1 | 44.44% |
| ktfmt/format/call/multiLineArgumentsWithTrailInvocation2.kts | 0/1 | 58.82% |
| ktfmt/format/call/multiLineArgumentsWithTrailLambda.kts | 0/1 | 44.44% |
| ktfmt/format/call/multiLineLambdaWithTrail.kts | 0/1 | 44.44% |
| ktfmt/format/call/namedArgsWithValueExpr.kt | 0/1 | 57.14% |
| ktfmt/format/call/nestedCallChains.kt | 0/1 | 18.18% |
| ktfmt/format/call/nestedCalls.kts | 0/1 | 52.17% |
| ktfmt/format/call/noForwardPropagationInCallExpr.kt | 0/1 | 50.00% |
| ktfmt/format/call/qualifiedExpressions.kt | 0/1 | 89.74% |
| ktfmt/format/call/shortCallChainWithLambda3.kts | 0/1 | 52.63% |
| ktfmt/format/call/trailingCommaInLambda.kt | 0/1 | 45.45% |
| ktfmt/format/call/trailingCommasInCalls.kt | 0/1 | 59.46% |
| ktfmt/format/class/constructors.kt | 0/1 | 77.97% |
| ktfmt/format/class/emptyEnumWithSemicolon2.kt | 0/1 | 0.00% |
| ktfmt/format/class/emptyEnumWithSemicolon3.kt | 0/1 | 25.00% |
| ktfmt/format/class/emptyEnumWithSemicolon6.kt | 0/1 | 50.00% |
| ktfmt/format/class/enumWithCommaAndSemicolon.kt | 0/1 | 80.00% |
| ktfmt/format/class/enumWithoutTrailingComma.kt | 0/1 | 80.00% |
| ktfmt/format/class/expectEnum.kt | 0/1 | 0.00% |
| ktfmt/format/class/functionalInterface.kt | 0/1 | 57.14% |
| ktfmt/format/class/functionalInterfaceWithTypeParams.kt | 0/1 | 66.67% |
| ktfmt/format/class/lineBreakOnBaseClass.kt | 0/1 | 28.57% |
| ktfmt/format/class/lineBreakOnTypeSpecifier.kt | 0/1 | 57.14% |
| ktfmt/format/class/primaryConstructor.kt | 0/1 | 60.00% |
| ktfmt/format/class/primaryConstructor3.kt | 0/1 | 86.96% |
| ktfmt/format/class/primaryConstructorKDoc.kt | 0/1 | 85.71% |
| ktfmt/format/class/secondaryConstructor.kt | 0/1 | 71.43% |
| ktfmt/format/class/secondaryConstructor2.kt | 0/1 | 85.71% |
| ktfmt/format/class/secondaryConstructor3.kt | 0/1 | 91.67% |
| ktfmt/format/class/secondaryConstructorDelegate.kt | 0/1 | 94.74% |
| ktfmt/format/class/secondaryConstructorDelegate2.kt | 0/1 | 52.63% |
| ktfmt/format/class/secondaryConstructorDelegate3.kt | 0/1 | 91.67% |
| ktfmt/format/class/superclasses2.kt | 0/1 | 84.62% |
| ktfmt/format/class/trailingCommaInConstructors.kt | 0/1 | 86.67% |
| ktfmt/format/class/trailingCommaInExplicitConstructors.kt | 0/1 | 73.68% |
| ktfmt/format/class/trailingCommaInSecondaryConstructors.kt | 0/1 | 85.71% |
| ktfmt/format/comment/blockComment.kt | 0/1 | 62.50% |
| ktfmt/format/comment/shebang.kts | 0/1 | 88.89% |
| ktfmt/format/enums/CommaWithSemicolon.kt | 0/1 | 80.00% |
| ktfmt/format/function/assignmentWithScopeFunction.kt | 0/1 | 14.29% |
| ktfmt/format/function/dotQualifiedScopeFun.kt | 0/1 | 40.35% |
| ktfmt/format/function/exprBodyWithScopeFun.kt | 0/1 | 30.77% |
| ktfmt/format/function/extensionFunWithALongName.kt | 0/1 | 88.89% |
| ktfmt/format/function/functionParams.kt | 0/1 | 87.50% |
| ktfmt/format/function/parametersBreakWithLambda.kt | 0/1 | 55.17% |
| ktfmt/format/function/returnTypes2.kt | 0/1 | 88.89% |
| ktfmt/format/function/trailingCommasInDefinitions.kt | 0/1 | 80.00% |
| ktfmt/format/if/comment.kt | 0/1 | 61.54% |
| ktfmt/format/if/expr.kt | 0/1 | 91.67% |
| ktfmt/format/if/multilineCond.kt | 0/1 | 84.62% |
| ktfmt/format/import/aliasedUnusedImports.kt | 0/1 | 83.33% |
| ktfmt/format/import/aliasedUsedImports.kt | 0/1 | 93.33% |
| ktfmt/format/import/commentsBetweenImports.kt | 0/1 | 83.33% |
| ktfmt/format/import/importList.kt | 0/1 | 50.00% |
| ktfmt/format/import/importsDeduplication.kt | 0/1 | 70.59% |
| ktfmt/format/import/importsInKDoc.kt | 0/1 | 83.64% |
| ktfmt/format/import/importsWithTopLevelVals.kt | 0/1 | 80.00% |
| ktfmt/format/import/importsWithTrailingExprs.kt | 0/1 | 66.67% |
| ktfmt/format/import/importsWithTrailingExprs2.kt | 0/1 | 66.67% |
| ktfmt/format/import/importsWithTrailingExprs3.kt | 0/1 | 66.67% |
| ktfmt/format/import/keepUnusedImports.kt | 0/1 | 42.86% |
| ktfmt/format/import/unusedImports.kt | 0/1 | 74.07% |
| ktfmt/format/import/unusedImportsOverloaded.kt | 0/1 | 91.67% |
| ktfmt/format/import/unusedImportsWithBackticks.kt | 0/1 | 88.89% |
| ktfmt/format/import/usedImportsFromSamePackage.kt | 0/1 | 94.12% |
| ktfmt/format/kdoc/basic.kt | 0/1 | 0.00% |
| ktfmt/format/kdoc/codeBlockStability.kt | 0/1 | 92.31% |
| ktfmt/format/kdoc/codeBlockWithTripleBacktick.kt | 0/1 | 93.33% |
| ktfmt/format/kdoc/codeBlocks.kt | 0/1 | 97.14% |
| ktfmt/format/kdoc/nestedKDoc.kt | 0/1 | 0.00% |
| ktfmt/format/lambda/lambdaAfterArgumentBreak.kt | 0/1 | 64.29% |
| ktfmt/format/lambda/lambdaArg.kt | 0/1 | 66.67% |
| ktfmt/format/lambda/lambdaAssignment.kt | 0/1 | 33.33% |
| ktfmt/format/lambda/lambdaBlocks.kt | 0/1 | 55.56% |
| ktfmt/format/lambda/lambdaChain.kt | 0/1 | 64.29% |
| ktfmt/format/lambda/lambdaChain2.kt | 0/1 | 0.00% |
| ktfmt/format/lambda/lambdaConditionaBreak.kt | 0/1 | 50.00% |
| ktfmt/format/lambda/lambdaWithFullType.kt | 0/1 | 44.44% |
| ktfmt/format/lambda/lambdaWithMissingOptionalArrow.kt | 0/1 | 30.77% |
| ktfmt/format/lambda/lambdaWithMultipleStatements.kt | 0/1 | 35.71% |
| ktfmt/format/lambda/lambdaWithMultipleStatementsAndComments.kt | 0/1 | 27.78% |
| ktfmt/format/lambda/lambdaWithRequiredArrow.kt | 0/1 | 30.77% |
| ktfmt/format/lambda/multiLineLambdaWithArgs.kt | 0/1 | 66.67% |
| ktfmt/format/lambda/multiLineLambdaWithOneStatement.kt | 0/1 | 66.67% |
| ktfmt/format/lambda/nestedMultiLineLambdas.kt | 0/1 | 77.27% |
| ktfmt/format/lambda/newLineBeforeNamedLambdaArg.kt | 0/1 | 83.33% |
| ktfmt/format/lambda/preserveLambdaBreaks.kt | 0/1 | 66.67% |
| ktfmt/format/lambda/preserveLambdaBreaksChainedCall.kt | 0/1 | 71.43% |
| ktfmt/format/lambda/preserveLambdaBreaksDanglingBracket.kt | 0/1 | 75.00% |
| ktfmt/format/lambda/preserveLambdaBreaksDisabled.kt | 0/1 | 75.00% |
| ktfmt/format/lambda/preserveLambdaBreaksMixed.kt | 0/1 | 81.82% |
| ktfmt/format/lambda/preserveLambdaBreaksNonTrailingLambdas.kt | 0/1 | 81.82% |
| ktfmt/format/lambda/preserveLambdaBreaksSingleStatement.kt | 0/1 | 75.00% |
| ktfmt/format/lambda/qualifiedExpressionsWithLambdas.kt | 0/1 | 79.69% |
| ktfmt/format/lambda/twoLambdas.kt | 0/1 | 50.00% |
| ktfmt/format/lambda/twoLambdas2.kt | 0/1 | 50.00% |
| ktfmt/format/misc/addingTrailingCommaOnMaxWidth.kt | 0/1 | 16.67% |
| ktfmt/format/misc/addingTrailingCommaWhenBreakingParameterList2.kt | 0/1 | 15.38% |
| ktfmt/format/misc/combination.kt | 0/1 | 6.90% |
| ktfmt/format/misc/commentStability.kt | 0/1 | 70.59% |
| ktfmt/format/misc/commentStability2.kt | 0/1 | 0.00% |
| ktfmt/format/misc/commentStability3-2.kts | 0/1 | 93.02% |
| ktfmt/format/misc/commentStability3.kt | 0/1 | 92.68% |
| ktfmt/format/misc/commentStability4.kt | 0/1 | 76.92% |
| ktfmt/format/misc/commentsRepectMaxWidth.kt | 0/1 | 66.67% |
| ktfmt/format/misc/contextParameters.kt | 0/1 | 48.65% |
| ktfmt/format/misc/contextReceivers.kt | 0/1 | 54.17% |
| ktfmt/format/misc/explicitBackingField.kt | 0/1 | 71.43% |
| ktfmt/format/misc/explicitBackingFieldWithoutType.kt | 0/1 | 75.00% |
| ktfmt/format/misc/explicitBackingWithPrivateSet.kt | 0/1 | 80.00% |
| ktfmt/format/misc/gh243.kt | 0/1 | 76.19% |
| ktfmt/format/misc/labels.kt | 0/1 | 78.79% |
| ktfmt/format/misc/maxOneLineBetweenTopLevelDecls.kt | 0/1 | 96.55% |
| ktfmt/format/misc/redundantSemicolons.kt | 0/1 | 93.62% |
| ktfmt/format/misc/semicolonsBetweenCalls.kt | 0/1 | 67.53% |
| ktfmt/format/misc/semicolonsInCommentsAndStrings.kt | 0/1 | 22.22% |
| ktfmt/format/misc/semicolonsInEmptyBodies.kt | 0/1 | 61.54% |
| ktfmt/format/misc/semicolonsInTopLevelStatements.kts | 0/1 | 20.00% |
| ktfmt/format/misc/trailingCommaOnSingleParameter.kt | 0/1 | 50.00% |
| ktfmt/format/misc/trailingCommaOnSingleParameter2.kt | 0/1 | 50.00% |
| ktfmt/format/misc/trailingCommas.kt | 0/1 | 3.57% |
| ktfmt/format/misc/unaryPostfix.kt | 0/1 | 90.00% |
| ktfmt/format/misc/unaryPrefix.kt | 0/1 | 57.89% |
| ktfmt/format/property/backingFieldWithChainedScopingFunction.kt | 0/1 | 46.15% |
| ktfmt/format/property/backingFieldWithChainedScopingFunction2.kt | 0/1 | 46.15% |
| ktfmt/format/property/backingFieldWithChainedScopingFunction3.kt | 0/1 | 57.14% |
| ktfmt/format/property/propertiesWithModifiers2.kt | 0/1 | 0.00% |
| ktfmt/format/property/propertyWithALongName.kt | 0/1 | 28.57% |
| ktfmt/format/property/propertyWithChainedScopingFunction.kt | 0/1 | 0.00% |
| ktfmt/format/property/propertyWithChainedScopingFunction2.kt | 0/1 | 0.00% |
| ktfmt/format/property/propertyWithChainedScopingFunction3.kt | 0/1 | 0.00% |
| ktfmt/format/property/propertyWithChainedScopingFunction4.kt | 0/1 | 0.00% |
| ktfmt/format/property/propertyWithChainedScopingFunction5.kt | 0/1 | 0.00% |
| ktfmt/format/property/trailingCommasInProperties.kt | 0/1 | 61.54% |
| ktfmt/format/string/callAfterMultilineString.kt | 0/1 | 9.52% |
| ktfmt/format/string/commentAfterMultilineString.kt | 0/1 | 54.55% |
| ktfmt/format/string/commentAfterMultilineString2.kt | 0/1 | 54.55% |
| ktfmt/format/string/commentAfterMultilineString3.kt | 0/1 | 46.15% |
| ktfmt/format/string/commentAfterMultilineString4.kt | 0/1 | 50.00% |
| ktfmt/format/string/multiDollarString.kt | 0/1 | 33.33% |
| ktfmt/format/string/multiLineStringWithSelector.kt | 0/1 | 72.22% |
| ktfmt/format/string/multilineStringLiterals.kt | 0/1 | 92.86% |
| ktfmt/format/string/multilineStringsWithTemplateExpressions.kt | 0/1 | 96.30% |
| ktfmt/format/string/multilineStringsWithTemplateExpressions2.kt | 0/1 | 40.00% |
| ktfmt/format/string/nestedMultilineString.kt | 0/1 | 90.91% |
| ktfmt/format/string/nestedMultilineString2.kt | 0/1 | 96.97% |
| ktfmt/format/string/trimIndentHandling.kt | 0/1 | 31.58% |
| ktfmt/format/string/trimIndentHandling2.kt | 0/1 | 25.00% |
| ktfmt/format/string/trimMarginAndTrimIndent.kts | 0/1 | 9.52% |
| ktfmt/format/string/trimMarginHandling.kt | 0/1 | 25.00% |
| ktfmt/format/string/trimMarginHandling2.kt | 0/1 | 25.00% |
| ktfmt/format/string/trimMarginHandling3.kt | 0/1 | 33.33% |
| ktfmt/format/string/trimMarginHandling4.kt | 0/1 | 40.00% |
| ktfmt/format/string/trimMarginHandling5.kt | 0/1 | 30.77% |
| ktfmt/format/string/whitespaces.kt | 0/1 | 78.95% |
| ktfmt/format/type/castsWithBreaks.kt | 0/1 | 43.24% |
| ktfmt/format/type/classExpression.kt | 0/1 | 66.67% |
| ktfmt/format/type/generics2.kt | 0/1 | 33.33% |
| ktfmt/format/type/generics3.kt | 0/1 | 30.00% |
| ktfmt/format/type/intersections.kt | 0/1 | 75.00% |
| ktfmt/format/type/nestedQualifiedTypes.kt | 0/1 | 40.00% |
| ktfmt/format/type/trailingCommasInFunctionTypes.kt | 0/1 | 50.00% |
| ktfmt/format/when/enum.kt | 0/1 | 0.00% |
| ktfmt/format/when/guards.kt | 0/1 | 58.33% |
| ktfmt/format/when/isAndIn.kt | 0/1 | 53.85% |
| ktfmt/format/when/lineBreaks.kt | 0/1 | 21.74% |
| ktfmt/format/when/multilineCondition.kt | 0/1 | 86.67% |
| ktfmt/format/when/multipleConditions.kt | 0/1 | 76.92% |
| ktfmt/format/when/newLinesBetweenClauses.kt | 0/1 | 72.00% |
| ktfmt/format/when/whenWithLambdaBody.kt | 0/1 | 0.00% |
| ktfmt/format/when/whenWithSubject.kt | 0/1 | 78.26% |
| ktfmt/google/anonymousFunction.kt | 0/1 | 85.71% |
| ktfmt/google/anonymousFunctionWithReceiver.kt | 0/1 | 85.71% |
| ktfmt/google/assignedLambda.kt | 0/1 | 14.29% |
| ktfmt/google/basic.kt | 0/1 | 47.06% |
| ktfmt/google/callAfterMultiLineString.kt | 0/1 | 72.22% |
| ktfmt/google/callAfterMultiLineString2.kt | 0/1 | 71.43% |
| ktfmt/google/callWithMultipleArguments.kt | 0/1 | 20.00% |
| ktfmt/google/casts.kt | 0/1 | 5.88% |
| ktfmt/google/chainedCalls.kt | 0/1 | 43.48% |
| ktfmt/google/chainedCallsIndents.kt | 0/1 | 78.05% |
| ktfmt/google/classTypeParams.kt | 0/1 | 63.29% |
| ktfmt/google/commaSeparatedLambdaParams.kt | 0/1 | 15.38% |
| ktfmt/google/commaSeparatedSupertypeList.kt | 0/1 | 25.00% |
| ktfmt/google/comments.kt | 0/1 | 3.70% |
| ktfmt/google/emitQualifiedExpression.kt | 0/1 | 89.47% |
| ktfmt/google/forcedBreaksInFunCalls.kt | 0/1 | 69.44% |
| ktfmt/google/forwardPropagationOfBreaks.kt | 0/1 | 50.00% |
| ktfmt/google/forwardPropagationOfBreaks2.kt | 0/1 | 14.29% |
| ktfmt/google/forwardPropagationOfBreaks3.kt | 0/1 | 33.33% |
| ktfmt/google/fqNestedTypes.kt | 0/1 | 18.18% |
| ktfmt/google/if.kt | 0/1 | 9.09% |
| ktfmt/google/ifWithElse.kt | 0/1 | 90.00% |
| ktfmt/google/ifWithMaxWidthCondition.kt | 0/1 | 47.06% |
| ktfmt/google/ifWithMultiLineCondition.kt | 0/1 | 83.33% |
| ktfmt/google/indentAfterABreak.kt | 0/1 | 51.85% |
| ktfmt/google/lastExpressionInQualifiedIndented.kt | 0/1 | 57.14% |
| ktfmt/google/longBinaryOps.kt | 0/1 | 41.67% |
| ktfmt/google/longFunctionTypeWrapping.kt | 0/1 | 23.53% |
| ktfmt/google/multiLineStringAsFunctionParam.kt | 0/1 | 91.67% |
| ktfmt/google/namedArgumentsWithValueExpression.kt | 0/1 | 47.06% |
| ktfmt/google/newLineBeforeNamedLambdaArg.kt | 0/1 | 80.00% |
| ktfmt/google/secondaryConstructorNoArgs.kt | 0/1 | 47.06% |
| ktfmt/google/singleLambdaArgument.kt | 0/1 | 62.50% |
| ktfmt/google/trailingBreakArgumentList.kt | 0/1 | 80.00% |
| ktfmt/google/trailingBreakChains.kts | 0/1 | 60.00% |
| ktfmt/google/trailingCommasAlwaysRemoved.kt | 0/1 | 52.17% |
| ktfmt/google/trailingCommasSingleElementLists.kt | 0/1 | 57.14% |
| ktfmt/google/trailingLambdaAfterArgumentBreak.kt | 0/1 | 63.04% |
| ktfmt/google/when.kt | 0/1 | 13.04% |
| ktfmt/google/whenWithMaxWidthCondition.kt | 0/1 | 42.11% |
| ktfmt/google/whenWithMultiLineCondition.kt | 0/1 | 85.71% |
| ktfmt/google/whileMaxWidthCondition.kt | 0/1 | 47.06% |
| ktfmt/google/whileWithMultilineContidion.kt | 0/1 | 83.33% |
| ktfmt/kotlinlang/nestedCalls.kts | 0/1 | 52.17% |
| ktfmt/new_codestyle/annotation/AnnotationsOnParameters.kt | 0/1 | 82.61% |
| ktfmt/new_codestyle/annotation/AnnotationsOnTypes.kt | 0/1 | 93.20% |
| ktfmt/new_codestyle/calls/gh633-2.kt | 0/1 | 43.59% |
| ktfmt/kdoc/testMultiLineLink.kt | 0/1 | 69.23% |
| ktfmt/kdoc/testPreStability.kt | 0/1 | 88.89% |
| ktfmt/kdoc/testPreStability2.kt | 0/1 | 94.12% |
| ktfmt/kdoc/testPreformattedText2.kt | 0/1 | 94.74% |
| ktfmt/kdoc/testPreformattedTextWithBlankLines.kt | 0/1 | 94.12% |
| ktfmt/kdoc/testPreformattedTextWithBlankLinesAndTrailingSpaces.kt | 0/1 | 94.12% |
| ktfmt/kdoc/testPreformattedTextSeparation.kt | 0/1 | 96.30% |
| ktfmt/kdoc/testSeparateParagraphMarkers1.kt | 0/1 | 57.14% |
| ktfmt/kdoc/testList1.kt | 0/1 | 20.00% |
| ktfmt/kdoc/testIndentedList.kt | 0/1 | 42.86% |
| ktfmt/kdoc/testHorizontalRuler.kt | 0/1 | 60.00% |
| ktfmt/kdoc/testQuoteOnlyOnFirstLine.kt | 0/1 | 53.33% |
| ktfmt/kdoc/testNoBreakUrl.kt | 0/1 | 60.00% |
| ktfmt/kdoc/testAsciiArt.kt | 0/1 | 80.00% |
| ktfmt/kdoc/testAsciiArt3.kt | 0/1 | 43.75% |
| ktfmt/kdoc/testBrokenAsciiArt.kt | 0/1 | 64.86% |
| ktfmt/kdoc/testHtmlLists.kt | 0/1 | 50.00% |
| ktfmt/kdoc/testVariousMarkup.kt | 0/1 | 75.52% |
| ktfmt/kdoc/testListContinuations.kt | 0/1 | 0.00% |
| ktfmt/kdoc/testTODO.kt | 0/1 | 37.21% |
| ktfmt/kdoc/testReorderTags.kt | 0/1 | 83.33% |
| ktfmt/kdoc/testNoReorderSample.kt | 0/1 | 91.89% |
| ktfmt/kdoc/testKDocOrdering.kt | 0/1 | 92.31% |
| ktfmt/kdoc/testHtml.kt | 0/1 | 50.11% |
| ktfmt/kdoc/testPreserveParagraph.kt | 0/1 | 0.00% |
| ktfmt/kdoc/testNestedBullets.kt | 0/1 | 50.00% |
| ktfmt/kdoc/test193246766.kt | 0/1 | 33.33% |
| ktfmt/kdoc/test203584301.kt | 0/1 | 72.73% |
| ktfmt/kdoc/test209435082.kt | 0/1 | 50.00% |
| ktfmt/kdoc/testKnit.kt | 0/1 | 31.11% |
| ktfmt/kdoc/testNPE.kt | 0/1 | 50.00% |
| ktfmt/kdoc/testExtraNewlines.kt | 0/1 | 97.87% |
| ktfmt/kdoc/testQuotedBug.kt | 0/1 | 72.73% |
| ktfmt/kdoc/testListBreaking.kt | 0/1 | 66.67% |
| ktfmt/kdoc/testNewList.kt | 0/1 | 71.43% |
| ktfmt/kdoc/testSplashScreen.kt | 0/1 | 64.56% |
| ktfmt/kdoc/testRaggedIndentation.kt | 0/1 | 53.85% |
| ktfmt/kdoc/testTables.kt | 0/1 | 60.00% |
| ktfmt/kdoc/testTableMixedWithHtml.kt | 0/1 | 25.00% |
| ktfmt/kdoc/testTableExtraCells.kt | 0/1 | 28.57% |
| ktfmt/kdoc/testTables2.kt | 0/1 | 33.33% |
| ktfmt/kdoc/testTables3.kt | 0/1 | 52.63% |
| ktfmt/kdoc/testTables4.kt | 0/1 | 60.00% |
| ktfmt/kdoc/testTablesEmptyCells.kt | 0/1 | 0.00% |
| ktfmt/kdoc/testTables5.kt | 0/1 | 38.10% |
| ktfmt/kdoc/testTables6.kt | 0/1 | 46.15% |
| ktfmt/kdoc/testTables7.kt | 0/1 | 66.67% |
| ktfmt/kdoc/testTables7b.kt | 0/1 | 66.67% |
| ktfmt/kdoc/testBulletsUnderParamTags.kt | 0/1 | 90.00% |
| ktfmt/kdoc/testPreTag.kt | 0/1 | 94.12% |
| ktfmt/kdoc/testPreTag3.kt | 0/1 | 41.67% |
| ktfmt/kdoc/testPreConversion2.kt | 0/1 | 94.74% |
| ktfmt/kdoc/testMarkupAcrossLines.kt | 0/1 | 33.33% |
| ktfmt/kdoc/testLineBreak.kt | 0/1 | 75.00% |
| ktfmt/kdoc/testDocTagsInsidePreformatted.kt | 0/1 | 96.77% |
| ktfmt/kdoc/testConvertMarkup2.kt | 0/1 | 0.00% |
| ktfmt/kdoc/testFencedCodeBlockInListItem.kt | 0/1 | 87.50% |
| ktfmt/kdoc/testFencedCodeBlockWithContinuationInListItem.kt | 0/1 | 84.21% |
| ktfmt/kdoc/testMultipleFencedCodeBlocksInListItem.kt | 0/1 | 81.48% |
| ktfmt/kdoc/testFencedCodeBlockAtEndOfListItem.kt | 0/1 | 92.31% |
| ktfmt/kdoc/testFencedCodeBlockInNumberedListItem.kt | 0/1 | 87.50% |
| ktfmt/kdoc/testNestedWithinQuoted.kt | 0/1 | 36.36% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| classes.txt: Enum classes | 1/1 | 46.15% | formatter-error: an enum body with members: enum_class_body at 89 |
| ktfmt/format/annotation/annotationEverywhere.kt | 1/1 | 0.00% | check: input "Fancy" at 75 is output as "Fancy1" at 79, which means "Fancy1", not "Fancy" |
| ktfmt/format/annotation/annotationInFunctionTypes.kt | 1/1 | 0.00% | check: input "Anno" at 16 is output as "AnnoList" at 16, which means "AnnoList", not "Anno" |
| ktfmt/format/annotation/annotationWithUseSiteTargets.kt | 1/1 | 60.00% | check: input "Inject" at 28 is output as "InjectNamed" at 30, which means "InjectNamed", not "Inject" |
| ktfmt/format/annotation/collectionLiterals.kt | 1/1 | 82.50% | formatter-error: no rule: collection_literal at 58 |
| ktfmt/format/annotation/expressions2.kt | 1/1 | 56.41% | check: input "Anno2" at 323 is output as "Anno2f" at 346, which means "Anno2f", not "Anno2" |
| ktfmt/format/annotation/functionTypes.kt | 1/1 | 70.59% | check: input "Inject" at 194 is output as "InjectNamed" at 185, which means "InjectNamed", not "Inject" |
| ktfmt/format/annotation/multipleAnnotations.kt | 1/1 | 63.16% | check: input "Annotation" at 158 is output as "Annotationreturn" at 157, which means "Annotationreturn", not "Annotation |
| ktfmt/format/annotation/noNewLineAfterAnnotations.kt | 1/1 | 64.94% | check: input comment "//" is missing from the output |
| ktfmt/format/call/gh633.kt | 1/1 | 31.58% | formatter-error: no rule: property_delegate at 255 |
| ktfmt/format/class/blankLineBetweenMembers.kt | 1/1 | 13.79% | formatter-error: an enum body with members: enum_class_body at 72 |
| ktfmt/format/class/emptyCompanionObject.kt | 1/1 | 53.85% | formatter-error: no rule: anonymous_initializer at 52 |
| ktfmt/format/class/emptyEnumWithSemicolon4.kt | 1/1 | 42.86% | formatter-error: an enum body with members: enum_class_body at 17 |
| ktfmt/format/class/emptyEnumWithSemicolon5.kt | 1/1 | 50.00% | check: the output has a syntax error at 31, which the input has not |
| ktfmt/format/class/enumWithMethods.kt | 1/1 | 33.33% | formatter-error: an enum body with members: enum_class_body at 25 |
| ktfmt/format/class/enumWithSemicolon.kt | 1/1 | 46.15% | formatter-error: an enum body with members: enum_class_body at 22 |
| ktfmt/format/class/initBlock.kt | 1/1 | 40.00% | formatter-error: no rule: anonymous_initializer at 14 |
| ktfmt/format/class/interfaceDelegation.kt | 1/1 | 100.00% | formatter-error: no rule: explicit_delegation at 32 |
| ktfmt/format/class/objectExpr.kt | 1/1 | 66.67% | formatter-error: no rule: object_literal at 24 |
| ktfmt/format/class/objectExpr2.kt | 1/1 | 66.67% | formatter-error: no rule: object_literal at 25 |
| ktfmt/format/class/trailingCommentAfterMethod.kt | 1/1 | 91.11% | check: output comment "// Hanging after fn // Trailing after fn" matches no input comment |
| ktfmt/format/function/varargs.kt | 1/1 | 50.00% | formatter-error: no rule: spread_expression at 38 |
| ktfmt/format/if/blocks.kt | 1/1 | 18.18% | formatter-error: no rule: do_while_statement at 34 |
| ktfmt/format/lambda/lambdaWithMultipleStatementsAndComments2.kt | 1/1 | 23.81% | check: input comment "/* no-op */" is missing from the output |
| ktfmt/format/lambda/lambdaWithOnlyComments.kt | 1/1 | 0.00% | check: input comment "/* do nothing */" is missing from the output |
| ktfmt/format/lambda/lambdaWithOnlyComments2.kt | 1/1 | 14.29% | check: input comment "/* do nothing */" is missing from the output |
| ktfmt/format/lambda/lambdaWithOptionalArrow.kt | 1/1 | 15.38% | check: input "->" at 10 is output as "}" at 9, which means "}", not "->" |
| ktfmt/format/lambda/lastParameterWithComment.kt | 1/1 | 64.29% | check: input comment "// no-op" is missing from the output |
| ktfmt/format/lambda/lastParameterWithComment2.kt | 1/1 | 42.50% | check: input comment "/* no-op */" is missing from the output |
| ktfmt/format/misc/doWhile.kt | 1/1 | 42.86% | formatter-error: no rule: do_while_statement at 18 |
| ktfmt/format/misc/semicolonsInEnums.kt | 1/1 | 66.67% | formatter-error: an enum body with members: enum_class_body at 118 |
| ktfmt/format/property/delegation.kt | 1/1 | 100.00% | formatter-error: no rule: property_delegate at 6 |
| ktfmt/format/property/delegation2.kt | 1/1 | 60.00% | formatter-error: no rule: property_delegate at 41 |
| ktfmt/format/property/delegationWithChainedScopingFunction.kt | 1/1 | 60.00% | formatter-error: no rule: property_delegate at 8 |
| ktfmt/format/property/delegationWithChainedScopingFunction2.kt | 1/1 | 60.00% | formatter-error: no rule: property_delegate at 8 |
| ktfmt/format/property/delegationWithChainedScopingFunction3.kt | 1/1 | 60.00% | formatter-error: no rule: property_delegate at 8 |
| ktfmt/format/property/lineCommentAboveDelegate.kt | 1/1 | 21.05% | formatter-error: no rule: property_delegate at 25 |
| ktfmt/format/property/propertiesWithAccessors.kt | 1/1 | 27.78% | formatter-error: no rule: parameter_with_optional_type at 95 |
| ktfmt/format/property/propertiesWithAccessors2.kt | 1/1 | 44.44% | formatter-error: no rule: property_delegate at 59 |
| ktfmt/format/type/compondBoundOnClassDelegate.kt | 1/1 | 100.00% | formatter-error: no rule: explicit_delegation at 17 |
| ktfmt/format/type/nullableTypes.kts | 1/1 | 82.35% | check: input "Anno" at 269 is output as "AnnoInt" at 269, which means "AnnoInt", not "Anno" |
| ktfmt/google/arrayLiteralInAnnotation.kt | 1/1 | 36.11% | formatter-error: no rule: collection_literal at 38 |
| ktfmt/google/comments2.kt | 1/1 | 30.00% | formatter-error: no rule: collection_literal at 38 |
| ktfmt/google/missingTrailingCommas.kt | 1/1 | 19.18% | formatter-error: no rule: collection_literal at 334 |
| ktfmt/google/redundantTrailingCommas.kt | 1/1 | 50.00% | formatter-error: no rule: collection_literal at 120 |
| ktfmt/google/trailingCommasInEnums.kt | 1/1 | 62.79% | formatter-error: an enum body with members: enum_class_body at 174 |
| ktfmt/google/trailingCommasNotAdded.kt | 1/1 | 21.74% | formatter-error: no rule: collection_literal at 112 |
| ktfmt/new_codestyle/annotation/AnnotationArguments.kt | 1/1 | 100.00% | formatter-error: no rule: collection_literal at 26 |
| ktfmt/new_codestyle/annotation/AnnotationOnExpression.kt | 1/1 | 85.48% | formatter-error: no rule: object_literal at 808 |
| ktfmt/new_codestyle/annotation/AnnotationOnExpressionFullWidth.kt | 1/1 | 83.20% | formatter-error: no rule: object_literal at 813 |
| ktfmt/new_codestyle/annotation/AnnotationsEverywhere.kt | 1/1 | 14.29% | check: input "Anno" at 208 is output as "Anno1" at 222, which means "Anno1", not "Anno" |
| ktfmt/new_codestyle/annotation/AnnotationsWithComments.kt | 1/1 | 76.19% | check: input "Anno2" at 131 is output as "Anno2f" at 130, which means "Anno2f", not "Anno2" |
| ktfmt/new_codestyle/annotation/DeclarationAnnotations.kt | 1/1 | 93.62% | check: input "Anno" at 740 is output as "Annoset" at 745, which means "Annoset", not "Anno" |
| ktfmt/new_codestyle/annotation/UseSiteTargets.kt | 1/1 | 52.94% | check: input "Inject" at 219 is output as "InjectNamed" at 219, which means "InjectNamed", not "Inject" |
| ktfmt/new_codestyle/calls/gh633.kt | 1/1 | 31.58% | formatter-error: no rule: property_delegate at 255 |

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
