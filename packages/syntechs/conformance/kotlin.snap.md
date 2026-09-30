kotlin compatibility: 743/753 (98.67%), 0 refused (ok:false), 11 excluded

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files, then the inputs of ktfmt's own tests: its cases/**/*.input files and KDocFormatterTest.kt's comments), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| comments.txt: Comments | 0/1 | 85.71% |
| source-files.txt: Multiple Imports On A Single Line | 0/1 | 50.00% |
| ktfmt/format/call/callArgsStickToFunctionName.kt | 0/1 | 60.00% |
| ktfmt/format/call/chainWithDereferences.kt | 0/1 | 50.00% |
| ktfmt/format/call/functionReference.kt | 0/1 | 88.00% |
| ktfmt/format/misc/labels.kt | 0/1 | 87.50% |
| ktfmt/format/misc/semicolonsBetweenCalls.kt | 0/1 | 96.20% |
| ktfmt/format/misc/semicolonsInEmptyBodies.kt | 0/1 | 60.00% |
| ktfmt/format/string/multiDollarString.kt | 0/1 | 44.44% |
| ktfmt/new_codestyle/annotation/AnnotationsOnTypes.kt | 0/1 | 93.20% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

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
