kotlin compatibility: 746/746 (100.00%), 0 refused (ok:false), 18 excluded

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files, then the inputs of ktfmt's own tests: its cases/**/*.input files and KDocFormatterTest.kt's comments), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |

# Excluded

## ktfmt is not idempotent on it (7)

- comments.txt: Comments
- ktfmt/format/misc/commentStability.kt
- ktfmt/format/misc/commentStability3-2.kts
- ktfmt/format/misc/commentStability3.kt
- ktfmt/format/misc/commentStability4.kt
- ktfmt/format/misc/semicolonsInEmptyBodies.kt
- ktfmt/kotlinlang/addingTrailingCommaOnMaxWidth.kts

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
