kotlin compatibility: 73/94 (77.66%), 13 refused (ok:false), 7 excluded

Fixtures: the kotlin grammar's vendored inputs (src/grammars/kotlin/corpus: the tree-sitter-kotlin test corpus examples, Logger.kt and the real-world files), expected output from ktfmt 0.64 --kotlinlang-style run on each.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |
| annotations.txt: Multi-annotations | 0/1 | 0.00% |
| annotations.txt: Annotated functions | 0/1 | 0.00% |
| comments.txt: Comments | 0/1 | 76.19% |
| expressions.txt: Lambda Expressions | 0/1 | 0.00% |
| expressions.txt: Comments in Strings | 0/1 | 85.71% |
| newlines.txt: get after newline | 0/1 | 66.67% |
| source-files.txt: Imports | 0/1 | 54.55% |
| source-files.txt: Multiple Imports On A Single Line | 0/1 | 0.00% |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| classes.txt: Properties | 1/1 | 83.33% | check: input "Int?" at 45 is output as "Int" at 48, which means "Int", not "Int?" |
| classes.txt: Enum classes | 1/1 | 46.15% | formatter-error: an enum body with members: enum_class_body at 89 |
| expressions.txt: Multiple Statements on a Single Line | 1/1 | 100.00% | check: input "val temp = b.y; b.y = b.z; b.z = temp" at 14 is output as "val" at 17, which means "val", not "val temp =  |
| literals.txt: Unsigned literal | 1/1 | 66.67% | formatter-error: no rule: unsigned_literal at 1 |
| literals.txt: Unsigned Long literal | 1/1 | 66.67% | formatter-error: no rule: unsigned_literal at 1 |
| statements.txt: Statements separated by semicolon | 1/1 | 100.00% | check: input "expectUnreached();  return false" at 38 is output as "expectUnreached" at 41, which means "expectUnreached |
| packages\syntechs\src\grammars\kotlin\corpus\tree-sitter-kotlin\Logger.kt | 1/1 | 30.49% | formatter-error: no rule: type_projection_modifiers at 1796 |
| packages\syntechs\src\grammars\kotlin\corpus\Collections.kt | 1/1 | 68.54% | formatter-error: no rule: long_literal at 1010 |
| packages\syntechs\src\grammars\kotlin\corpus\Result.kt | 1/1 | 76.47% | formatter-error: no rule: type_parameter_modifiers at 644 |
| packages\syntechs\src\grammars\kotlin\corpus\Delay.kt | 1/1 | 62.65% | formatter-error: no rule: long_literal at 6898 |
| packages\syntechs\src\grammars\kotlin\corpus\Transform.kt | 1/1 | 56.32% | formatter-error: parameter modifiers: function_value_parameters at 489 |
| packages\syntechs\src\grammars\kotlin\corpus\Okio.kt | 1/1 | 63.58% | formatter-error: no rule: try_expression at 1833 |
| packages\syntechs\src\grammars\kotlin\corpus\build.gradle.kts | 1/1 | 75.09% | check: input "Node?" at 5560 is output as "Node" at 6198, which means "Node", not "Node?" |

# Excluded

## ktfmt rejects the input (7)

- expressions.txt: Safe Navigation
- expressions.txt: Less than for comparison
- statements.txt: Getters
- types.txt: Type constructor
- types.txt: Type constructor with trailing comma
- types.txt: Ampersand type
- types.txt: Ampersand type with modifiers
