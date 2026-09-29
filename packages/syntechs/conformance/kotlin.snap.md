kotlin compatibility: 696/753 (92.43%), 2 refused (ok:false), 11 excluded

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files, then the inputs of ktfmt's own tests: its cases/**/*.input files and KDocFormatterTest.kt's comments), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| comments.txt: Comments | 0/1 | 76.19% |
| source-files.txt: Multiple Imports On A Single Line | 0/1 | 50.00% |
| packages/syntechs/src/grammars/kotlin/corpus/Collections.kt | 0/1 | 96.90% |
| packages/syntechs/src/grammars/kotlin/corpus/Result.kt | 0/1 | 99.56% |
| packages/syntechs/src/grammars/kotlin/corpus/Delay.kt | 0/1 | 99.71% |
| packages/syntechs/src/grammars/kotlin/corpus/Transform.kt | 0/1 | 98.98% |
| packages/syntechs/src/grammars/kotlin/corpus/Okio.kt | 0/1 | 97.44% |
| ktfmt/format/annotation/exception.kt | 0/1 | 61.54% |
| ktfmt/format/annotation/functionTypes.kt | 0/1 | 60.00% |
| ktfmt/format/annotation/noNewLineAfterAnnotations.kt | 0/1 | 80.52% |
| ktfmt/format/binary/binaryExpressionWithRanges.kt | 0/1 | 52.63% |
| ktfmt/format/call/arrayAccessInTheCallChain.kt | 0/1 | 58.33% |
| ktfmt/format/call/callArgsStickToFunctionName.kt | 0/1 | 60.00% |
| ktfmt/format/call/chainWithDereferences.kt | 0/1 | 50.00% |
| ktfmt/format/call/functionReference.kt | 0/1 | 88.00% |
| ktfmt/format/call/trailingCommasInCalls.kt | 0/1 | 93.33% |
| ktfmt/format/class/emptyCompanionObject.kt | 0/1 | 92.31% |
| ktfmt/format/class/secondaryConstructorDelegate2.kt | 0/1 | 52.63% |
| ktfmt/format/comment/shebang.kts | 0/1 | 88.89% |
| ktfmt/format/if/blocks.kt | 0/1 | 21.05% |
| ktfmt/format/if/comment.kt | 0/1 | 61.54% |
| ktfmt/format/import/importList.kt | 0/1 | 62.50% |
| ktfmt/format/lambda/lambdaArg.kt | 0/1 | 72.22% |
| ktfmt/format/lambda/lambdaWithFullType.kt | 0/1 | 44.44% |
| ktfmt/format/misc/commentStability.kt | 0/1 | 70.59% |
| ktfmt/format/misc/contextParameters.kt | 0/1 | 61.54% |
| ktfmt/format/misc/contextReceivers.kt | 0/1 | 64.00% |
| ktfmt/format/misc/labels.kt | 0/1 | 78.79% |
| ktfmt/format/misc/semicolonsBetweenCalls.kt | 0/1 | 96.20% |
| ktfmt/format/misc/semicolonsInEmptyBodies.kt | 0/1 | 69.23% |
| ktfmt/format/misc/trailingCommas.kt | 0/1 | 22.81% |
| ktfmt/format/misc/unaryPostfix.kt | 0/1 | 90.00% |
| ktfmt/format/misc/unaryPrefix.kt | 0/1 | 57.89% |
| ktfmt/format/property/backingFieldWithChainedScopingFunction3.kt | 0/1 | 76.92% |
| ktfmt/format/property/trailingCommasInProperties.kt | 0/1 | 72.73% |
| ktfmt/format/string/multiDollarString.kt | 0/1 | 44.44% |
| ktfmt/format/type/classExpression.kt | 0/1 | 66.67% |
| ktfmt/format/type/intersections.kt | 0/1 | 75.00% |
| ktfmt/format/type/nestedQualifiedTypes.kt | 0/1 | 50.00% |
| ktfmt/format/when/guards.kt | 0/1 | 58.33% |
| ktfmt/google/comments.kt | 0/1 | 85.71% |
| ktfmt/google/forcedBreaksInFunCalls.kt | 0/1 | 88.00% |
| ktfmt/google/fqNestedTypes.kt | 0/1 | 40.00% |
| ktfmt/google/longFunctionTypeWrapping.kt | 0/1 | 33.33% |
| ktfmt/google/redundantTrailingCommas.kt | 0/1 | 83.33% |
| ktfmt/google/secondaryConstructorNoArgs.kt | 0/1 | 47.06% |
| ktfmt/google/singleLambdaArgument.kt | 0/1 | 68.75% |
| ktfmt/google/trailingCommasAlwaysRemoved.kt | 0/1 | 88.00% |
| ktfmt/google/trailingCommasNotAdded.kt | 0/1 | 79.07% |
| ktfmt/google/trailingCommasSingleElementLists.kt | 0/1 | 82.61% |
| ktfmt/new_codestyle/annotation/AnnotationsEverywhere.kt | 0/1 | 96.97% |
| ktfmt/new_codestyle/annotation/AnnotationsOnParameters.kt | 0/1 | 82.61% |
| ktfmt/new_codestyle/annotation/AnnotationsOnTypes.kt | 0/1 | 93.20% |
| ktfmt/new_codestyle/annotation/DeclarationAnnotations.kt | 0/1 | 93.62% |
| ktfmt/new_codestyle/annotation/UseSiteTargets.kt | 0/1 | 90.48% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| ktfmt/format/class/trailingCommentAfterMethod.kt | 1/1 | 93.48% | check: output comment "//" matches no input comment |
| ktfmt/google/comments2.kt | 1/1 | 67.92% | check: input comment "Comment" is missing from the output |

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
