swift@swift-format compatibility: 76/93 (81.72%), 17 refused (ok:false), 0 excluded

Fixtures: the swift grammar's vendored inputs (src/grammars/swift/corpus/swift-format: swift-format 603.0.0's own Sources/SwiftFormat), expected output from swift-format 6.3.0 run on each, recorded beside it by fetch-corpus.sh swift.

# Failed

Printed, but not as the reference prints it. A run is one option set of the fixture's spec.

| Fixture | Runs passed | Match ratio |
| :------ | :---------: | :---------: |

# Refused

The formatter threw (ok:false), or `check` found that its output says something the input does not.

| Fixture | Runs refused | Match ratio | First reason |
| :------ | :----------: | :---------: | :----------- |
| API/Configuration.swift | 1/1 | 97.99% | formatter-error: a `assignment` in a line past the width (line breaking): `self.multilineTrailingCommaBehavior =` |
| API/Selection.swift | 1/1 | 96.77% | formatter-error: access level on an extension (NoAccessLevelOnExtensionDeclaration): public extension Syntax { |
| Core/Parsing.swift | 1/1 | 96.25% | formatter-error: a `postfix_expression` in a line past the width (line breaking): `operatorTable.foldAll(Parser.parse(so |
| Core/RuleNameCache+Generated.swift | 1/1 | 88.19% | formatter-error: a `attribute` in a line past the width (line breaking): `@_spi(Testing)` |
| Core/SyntaxTraits.swift | 1/1 | 94.55% | formatter-error: a `function_declaration` in a line past the width (line breaking): `func asProtocol(_: KeywordModifiedE |
| PrettyPrint/Comment.swift | 1/1 | 98.98% | formatter-error: a parse error before `in` (grammar) |
| PrettyPrint/PrettyPrint.swift | 1/1 | 99.20% | formatter-error: a `init_declaration` in a line past the width (line breaking): `public init(context: Context, source: S |
| PrettyPrint/TokenStreamCreator.swift | 1/1 | 97.84% | formatter-error: access level on an extension (NoAccessLevelOnExtensionDeclaration): fileprivate extension AccessorBlock |
| Rules/DontRepeatTypeInStaticProperties.swift | 1/1 | 98.86% | formatter-error: a `navigation_expression` in a line past the width (line breaking): `bindings.first?.typeAnnotation` |
| Rules/NeverUseImplicitlyUnwrappedOptionals.swift | 1/1 | 97.26% | formatter-error: a `navigation_expression` in a line past the width (line breaking): `(attribute.as(AttributeSyntax.self |
| Rules/NoAssignmentInExpressions.swift | 1/1 | 99.09% | formatter-error: a `while_statement` in a line past the width (line breaking): `while let parent = node.parent,` |
| Rules/OmitExplicitReturns.swift | 1/1 | 98.13% | formatter-error: a `function_declaration` in a line past the width (line breaking): `private func transformAccessorBlock |
| Rules/OrderedImports.swift | 1/1 | 98.88% | formatter-error: a parse error before `)` (grammar) |
| Rules/UseLetInEveryBoundCaseVariable.swift | 1/1 | 99.01% | formatter-error: a `function_declaration` in a line past the width (line breaking): `public override func visit(_ node:  |
| Rules/UseShorthandTypeNames.swift | 1/1 | 99.35% | formatter-error: a `case` in a line past the width (line breaking): `case` |
| Rules/UseSynthesizedInitializer.swift | 1/1 | 97.71% | formatter-error: a `lambda_literal` in a line past the width (line breaking): `{ $0.decl.is(InitializerDeclSyntax.self)  |
| Utilities/FileIterator.swift | 1/1 | 94.26% | formatter-error: a `init_declaration` in a line past the width (line breaking): `public init(urls: [URL], followSymlinks |
