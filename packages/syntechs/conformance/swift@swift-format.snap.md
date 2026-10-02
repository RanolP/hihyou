swift@swift-format compatibility: 64/93 (68.82%), 29 refused (ok:false), 0 excluded

Fixtures: the swift grammar's vendored inputs (src/grammars/swift/corpus/swift-format: swift-format 603.0.0's own Sources/SwiftFormat), expected output from swift-format 6.3.0 run on each, recorded beside it by fetch-corpus.sh swift.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| API/Configuration.swift | 1/1 | 97.99% | formatter-error: code past column 100 (line breaking): `multilineTrailingCommaBehavior` ends at column 112 |
| API/Selection.swift | 1/1 | 96.77% | formatter-error: access level on an extension (NoAccessLevelOnExtensionDeclaration): public extension Syntax { |
| Core/Parsing.swift | 1/1 | 96.25% | formatter-error: code past column 100 (line breaking): `experimentalFeaturesSet` ends at column 105 |
| Core/RuleMask.swift | 1/1 | 99.48% | formatter-error: code past column 100 (line breaking): `makeRegex` ends at column 102 |
| Core/RuleNameCache+Generated.swift | 1/1 | 88.19% | formatter-error: code past column 100 (line breaking): `AllPublicDeclarationsHaveDocumentation` ends at column 104 |
| Core/SyntaxTraits.swift | 1/1 | 94.55% | formatter-error: code past column 100 (line breaking): `KeywordModifiedExprSyntaxProtocol` ends at column 101 |
| Core/Trivia+Convenience.swift | 1/1 | 98.66% | formatter-error: code past column 100 (line breaking): `index` ends at column 101 |
| PrettyPrint/Comment.swift | 1/1 | 98.98% | formatter-error: a parse error before `in` (grammar) |
| PrettyPrint/PrettyPrint.swift | 1/1 | 99.20% | formatter-error: code past column 100 (line breaking): `:` ends at column 101 |
| PrettyPrint/TokenStreamCreator.swift | 1/1 | 97.84% | formatter-error: access level on an extension (NoAccessLevelOnExtensionDeclaration): fileprivate extension AccessorBlock |
| Rules/AllPublicDeclarationsHaveDocumentation.swift | 1/1 | 98.56% | formatter-error: code past column 100 (line breaking): `modifiers` ends at column 105 |
| Rules/AlwaysUseLowerCamelCase.swift | 1/1 | 99.36% | formatter-error: code past column 100 (line breaking): `Testing` ends at column 103 |
| Rules/AvoidRetroactiveConformances.swift | 1/1 | 96.10% | formatter-error: code past column 100 (line breaking): `do not declare retroactive conformances` ends at column 104 |
| Rules/BeginDocumentationCommentWithOneLineSummary.swift | 1/1 | 84.96% | formatter-error: #if body flush with its directive (conditional compilation) |
| Rules/DontRepeatTypeInStaticProperties.swift | 1/1 | 98.86% | formatter-error: code past column 100 (line breaking): `FunctionCallExprSyntax` ends at column 108 |
| Rules/NeverUseImplicitlyUnwrappedOptionals.swift | 1/1 | 97.26% | formatter-error: code past column 100 (line breaking): `text` ends at column 101 |
| Rules/NoAccessLevelOnExtensionDeclaration.swift | 1/1 | 94.32% | formatter-error: code past column 100 (line breaking): `actorKeyword` ends at column 106 |
| Rules/NoAssignmentInExpressions.swift | 1/1 | 99.09% | formatter-error: code past column 100 (line breaking): `.` ends at column 101 |
| Rules/NoCasesWithOnlyFallthrough.swift | 1/1 | 99.35% | formatter-error: code past column 100 (line breaking): `)` ends at column 101 |
| Rules/NoEmptyLineOpeningClosingBraces.swift | 1/1 | 98.62% | formatter-error: code past column 100 (line breaking): `fromClosingBrace` ends at column 106 |
| Rules/OmitExplicitReturns.swift | 1/1 | 98.13% | formatter-error: code past column 100 (line breaking): `{` ends at column 101 |
| Rules/OneCasePerLine.swift | 1/1 | 98.95% | formatter-error: code past column 100 (line breaking): `{` ends at column 102 |
| Rules/OrderedImports.swift | 1/1 | 98.88% | formatter-error: a parse error before `)` (grammar) |
| Rules/ReplaceForEachWithForLoop.swift | 1/1 | 96.23% | formatter-error: code past column 100 (line breaking): `isEmpty` ends at column 105 |
| Rules/UseLetInEveryBoundCaseVariable.swift | 1/1 | 99.01% | formatter-error: code past column 100 (line breaking): `MatchingPatternConditionSyntax` ends at column 102 |
| Rules/UseShorthandTypeNames.swift | 1/1 | 99.35% | formatter-error: code past column 100 (line breaking): `.` ends at column 101 |
| Rules/UseSynthesizedInitializer.swift | 1/1 | 97.71% | formatter-error: code past column 100 (line breaking): `}` ends at column 102 |
| Utilities/FileIterator.swift | 1/1 | 94.26% | formatter-error: code past column 100 (line breaking): `{` ends at column 101 |
| Utilities/URL+isRoot.swift | 1/1 | 52.73% | formatter-error: #if body flush with its directive (conditional compilation) |
