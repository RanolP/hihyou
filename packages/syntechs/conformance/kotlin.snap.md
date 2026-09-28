kotlin compatibility: not implemented

Other formatters on the same fixtures, fixtures passed:

- unformatted input (no formatter yet): 0/94 (0.00%)

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Excluded

## ktfmt rejects the input (7)

- expressions.txt: Safe Navigation
- expressions.txt: Less than for comparison
- statements.txt: Getters
- types.txt: Type constructor
- types.txt: Type constructor with trailing comma
- types.txt: Ampersand type
- types.txt: Ampersand type with modifiers
