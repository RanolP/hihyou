kotlin compatibility: 82/94 (87.23%), 6 refused (ok:false), 7 excluded

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| annotations.txt: Multi-annotations | 0/1 | 0.00% |
| comments.txt: Comments | 0/1 | 76.19% |
| source-files.txt: Imports | 0/1 | 54.55% |
| source-files.txt: Multiple Imports On A Single Line | 0/1 | 0.00% |
| packages\syntechs\src\grammars\kotlin\corpus\Delay.kt | 0/1 | 67.86% |
| packages\syntechs\src\grammars\kotlin\corpus\build.gradle.kts | 0/1 | 86.83% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| classes.txt: Enum classes | 1/1 | 46.15% | formatter-error: an enum body with members: enum_class_body at 89 |
| packages\syntechs\src\grammars\kotlin\corpus\tree-sitter-kotlin\Logger.kt | 1/1 | 30.49% | formatter-error: parameter modifiers: function_value_parameters at 1954 |
| packages\syntechs\src\grammars\kotlin\corpus\Collections.kt | 1/1 | 68.54% | formatter-error: parameter modifiers: function_value_parameters at 3340 |
| packages\syntechs\src\grammars\kotlin\corpus\Result.kt | 1/1 | 76.47% | formatter-error: a primary constructor with modifiers: primary_constructor at 651 |
| packages\syntechs\src\grammars\kotlin\corpus\Transform.kt | 1/1 | 56.32% | formatter-error: parameter modifiers: function_value_parameters at 489 |
| packages\syntechs\src\grammars\kotlin\corpus\Okio.kt | 1/1 | 94.81% | check: input "null" at 1901 is output as "}" at 1951, which means "}", not "null" |

# Excluded

## ktfmt rejects the input (7)

- expressions.txt: Safe Navigation
- expressions.txt: Less than for comparison
- statements.txt: Getters
- types.txt: Type constructor
- types.txt: Type constructor with trailing comma
- types.txt: Ampersand type
- types.txt: Ampersand type with modifiers
