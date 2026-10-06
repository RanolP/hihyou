import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { format } from "../../fmt/format.js";
import { swift } from "./fmt.js";
import { language } from "./index.js";

const run = (text: string) => format(parseTree(language, text), swift);

// Every expected text below is swift-format 6.3.0's output for the input.

// A regression here is the #if re-indent dropped or applied at the wrong depth, so a flush conditional body would
// show as unchanged where swift-format indents it.
test("a flush #if body is indented two spaces per nesting level", () => {
  const flat = run("#if os(macOS)\nimport AppKit\n#endif\n");
  expect(flat.ok && flat.text).toBe("#if os(macOS)\n  import AppKit\n#endif\n");
  const out = run(
    "func f() {\n  #if A\n  let a = 1\n  #if B\n  let b = 2\n  #else\n  let c = 3\n  #endif\n  #endif\n}\n",
  );
  expect(out.ok && out.text).toBe(
    "func f() {\n  #if A\n    let a = 1\n    #if B\n      let b = 2\n    #else\n      let c = 3\n    #endif\n  #endif\n}\n",
  );
});

// A regression here is a refusal check loosened, so syntechs would print as written a file swift-format rewrites
// (operator spacing, brace spacing, semicolons, `else` placement, import order, 4-space indent).
test("input swift-format would rewrite and syntechs cannot is refused", () => {
  for (const input of [
    "let a = 1+2\n",
    "func f(){\n  let a = 1\n}\n",
    "let a = b ;let c = d\n",
    "if a {\n  b()\n}\nelse {\n  c()\n}\n",
    "import B\nimport A\n",
    "func f() {\n    let a = 1\n}\n",
    "let a = b\n  .c()\n",
  ])
    expect(run(input).ok, input).toBe(false);
});

// A regression here is the whitespace cleanup lost: trailing spaces, a run of blank lines, or edge blank lines kept.
test("trailing whitespace and extra blank lines are removed", () => {
  const out = run("\n\nlet a = 1   \n\n\n\nlet b = 2\n\n\n");
  expect(out.ok && out.text).toBe("let a = 1\n\nlet b = 2\n");
});

// A regression here is the PrettyPrinter port or the call/binding token streams drifting from swift-format: a
// break placed after `=` where it belongs inside the parentheses, a lost continuation indent, or a stray newline.
test("a statement past 100 columns is broken as swift-format breaks it", () => {
  const cases: [string, string][] = [
    [
      "func f() {\n  diagnoseMissingDocComment(DeclSyntax(node), name: \"\\(mainBinding.pattern)\", modifiers: node.modifiers)\n}\n",
      "func f() {\n  diagnoseMissingDocComment(\n    DeclSyntax(node), name: \"\\(mainBinding.pattern)\", modifiers: node.modifiers)\n}\n",
    ],
    [
      "func f() {\n  let allowUnderscores = testCaseFuncs.contains(node) || node.hasAttribute(\"Test\", inModule: \"Testing\")\n}\n",
      "func f() {\n  let allowUnderscores =\n    testCaseFuncs.contains(node) || node.hasAttribute(\"Test\", inModule: \"Testing\")\n}\n",
    ],
    [
      "struct S {\n  fileprivate static let doNotUseRetroactive: Finding.Message = \"do not declare retroactive conformances\"\n  let b = 1\n}\n",
      "struct S {\n  fileprivate static let doNotUseRetroactive: Finding.Message =\n    \"do not declare retroactive conformances\"\n  let b = 1\n}\n",
    ],
    [
      "struct S {\n  private static let ignoreFileRegex: IgnoreDirective.RegexExpression = IgnoreDirective.file.makeRegex()\n}\n",
      "struct S {\n  private static let ignoreFileRegex: IgnoreDirective.RegexExpression = IgnoreDirective.file\n    .makeRegex()\n}\n",
    ],
  ];
  for (const [input, want] of cases) {
    const out = run(input);
    expect(out.ok && out.text, input).toBe(want);
  }
});

// A regression here is an unported construct laid out anyway: a lone dictionary argument.
test("a long line whose layout is not ported is refused", () => {
  for (const input of [
    "let a = bbbbbbbbbbbbbbbbbbbbbbbb.map([cccccccccccccccccccccccccc: ddddddddddddddddddddddddddddddd, eeeeeeeeeeeeeee: f])\n",
  ])
    expect(run(input).ok, input).toBe(false);
});

// A regression here is mustBreakBeforeClosingDelimiter lost: a member after a call's arguments (`f(x).y`) puts the
// `)` on its own line once the arguments break, as the corpus's `TokenStreamCreator(…).makeStream(from:)` shows.
// The expected text follows that rule, as swift-format cannot run here.
test("a member after a broken call's arguments follows the `)` on its own line", () => {
  const out = run(
    "func f() {\n  try aaaaaaaaaaaaaaaaaaa.encode(bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, forKey: .ccccccccccccccccccccccccc).dddd()\n}\n",
  );
  expect(out.ok && out.text).toBe(
    "func f() {\n  try aaaaaaaaaaaaaaaaaaa.encode(\n    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, forKey: .ccccccccccccccccccccccccc\n  ).dddd()\n}\n",
  );
});

// A regression here is the IfExpr/GuardStmt condition breaks or the `||` refold lost: the `||` left on the wrong
// line, `else` or `{` kept on the condition's line, or the conditions indented without their continuation.
test("a long if or guard header is broken as swift-format breaks it", () => {
  const cases: [string, string][] = [
    [
      "func f() {\n  guard aaaaaaaaaaaaaaaaaaaaaaaaaaa || bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb || cccccccccccccccccccccccccccccccccccccc else {\n    x()\n  }\n}\n",
      "func f() {\n  guard\n    aaaaaaaaaaaaaaaaaaaaaaaaaaa || bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n      || cccccccccccccccccccccccccccccccccccccc\n  else {\n    x()\n  }\n}\n",
    ],
    [
      "func f() {\n  if !node.arguments.isEmpty || node.trailingClosure == nil || !node.additionalTrailingClosures.isEmpty {\n    x()\n  }\n}\n",
      "func f() {\n  if !node.arguments.isEmpty || node.trailingClosure == nil\n    || !node.additionalTrailingClosures.isEmpty\n  {\n    x()\n  }\n}\n",
    ],
  ];
  for (const [input, want] of cases) {
    const out = run(input);
    expect(out.ok && out.text, input).toBe(want);
  }
});

// A regression here is the TryExpr, ReturnStmt or TuplePattern token streams drifting: a break placed after `try`,
// `return` or `=` where swift-format breaks inside the call's parentheses.
test("a long try, return or tuple binding is broken inside the call", () => {
  const cases: [string, string][] = [
    [
      "func f() {\n  try container.encode(lineBreakBeforeControlFlowKeywords, forKey: .lineBreakBeforeControlFlowKeywords)\n}\n",
      "func f() {\n  try container.encode(\n    lineBreakBeforeControlFlowKeywords, forKey: .lineBreakBeforeControlFlowKeywords)\n}\n",
    ],
    [
      "func f() {\n  return aaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccccccccc(dddddddd)\n}\n",
      "func f() {\n  return aaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccccccccccccc(\n    dddddddd)\n}\n",
    ],
    [
      "func f() {\n  let (trimmedLeadingTrivia, count) = first.leadingTrivia.trimmingSuperfluousNewlines(fromClosingBrace: false)\n}\n",
      "func f() {\n  let (trimmedLeadingTrivia, count) = first.leadingTrivia.trimmingSuperfluousNewlines(\n    fromClosingBrace: false)\n}\n",
    ],
  ];
  for (const [input, want] of cases) {
    const out = run(input);
    expect(out.ok && out.text, input).toBe(want);
  }
});

// A regression here is the FunctionDecl/InitializerDecl signature streams drifting: `->` kept on the parameters'
// line past the width, `{` left on a continuation line, or the parameters not moved inside the parentheses.
test("a long function or init signature is broken as swift-format breaks it", () => {
  const cases: [string, string][] = [
    [
      "struct S {\n  public override func visit(_ node: MatchingPatternConditionSyntax) -> MatchingPatternConditionSyntax {\n    return x\n  }\n}\n",
      "struct S {\n  public override func visit(_ node: MatchingPatternConditionSyntax)\n    -> MatchingPatternConditionSyntax\n  {\n    return x\n  }\n}\n",
    ],
    [
      "struct S {\n  public init(context: Context, source: String, node: Syntax, printTokenStream: Bool, whitespaceOnly: Bool) {\n    x()\n  }\n}\n",
      "struct S {\n  public init(\n    context: Context, source: String, node: Syntax, printTokenStream: Bool, whitespaceOnly: Bool\n  ) {\n    x()\n  }\n}\n",
    ],
    [
      "func aaaaaaaaaaaaaaaa<T>(bbbbbbbbbbbbb: T, ccccccccccccccccc: String) -> Int where T: Equatable, T: Hashable {\n  x()\n}\n",
      "func aaaaaaaaaaaaaaaa<T>(bbbbbbbbbbbbb: T, ccccccccccccccccc: String) -> Int\nwhere T: Equatable, T: Hashable {\n  x()\n}\n",
    ],
  ];
  for (const [input, want] of cases) {
    const out = run(input);
    expect(out.ok && out.text, input).toBe(want);
  }
});

// A regression here is the TernaryExpr stream drifting: the `? a : b` part split apart, or `c ? a` kept together
// where swift-format breaks before the `?`.
test("a long ternary is broken before its `?` as swift-format breaks it", () => {
  const cases: [string, string][] = [
    [
      "func f() -> Int {\n  return a != b ? someVeryLongValueNameForTheThenBranchThatIsLong : someOtherVeryLongValueNameForElse\n}\n",
      "func f() -> Int {\n  return a != b\n    ? someVeryLongValueNameForTheThenBranchThatIsLong : someOtherVeryLongValueNameForElse\n}\n",
    ],
    [
      "func f() {\n  someFunctionCall(firstArgument: 1, second: conditionValueThatIsLong ? firstLongerValueName : secondLongerValueName)\n}\n",
      "func f() {\n  someFunctionCall(\n    firstArgument: 1,\n    second: conditionValueThatIsLong ? firstLongerValueName : secondLongerValueName)\n}\n",
    ],
  ];
  for (const [input, want] of cases) {
    const out = run(input);
    expect(out.ok && out.text, input).toBe(want);
  }
});

// A regression here is a line break in a long statement handled unlike swift-format's discretionary newlines: one
// kept at a break (an argument, a `while` condition, after `=`) printed joined, or the one before a body's `{`,
// which swift-format ignores, kept.
test("a long statement spanning lines keeps the line breaks swift-format keeps", () => {
  const cases: [string, string][] = [
    [
      "func f() {\n  while let parent = node.parent,\n    parent.is(TryExprSyntax.self) || parent.is(AwaitExprSyntax.self) || parent.is(UnsafeExprSyntax.self)\n  {\n    node = parent\n  }\n}\n",
      "func f() {\n  while let parent = node.parent,\n    parent.is(TryExprSyntax.self) || parent.is(AwaitExprSyntax.self)\n      || parent.is(UnsafeExprSyntax.self)\n  {\n    node = parent\n  }\n}\n",
    ],
    [
      "func f() {\n  self.multilineTrailingCommaBehavior =\n    try container.decodeIfPresent(MultilineTrailingCommaBehavior.self, forKey: .multilineTrailingCommaBehavior)\n    ?? defaults.multilineTrailingCommaBehavior\n}\n",
      "func f() {\n  self.multilineTrailingCommaBehavior =\n    try container.decodeIfPresent(\n      MultilineTrailingCommaBehavior.self, forKey: .multilineTrailingCommaBehavior)\n    ?? defaults.multilineTrailingCommaBehavior\n}\n",
    ],
    [
      "func aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa(bbbbbbbbb: Int)\n{\n  x()\n}\n",
      "func aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa(\n  bbbbbbbbb: Int\n) {\n  x()\n}\n",
    ],
    [
      "func f() {\n  context.findingEmitter.emit(message,\n    location: Finding.Location(file: context.fileURL.relativePath, line: outputBuffer.lineNumber, column: column))\n}\n",
      "func f() {\n  context.findingEmitter.emit(\n    message,\n    location: Finding.Location(\n      file: context.fileURL.relativePath, line: outputBuffer.lineNumber, column: column))\n}\n",
    ],
  ];
  for (const [input, want] of cases) {
    const out = run(input);
    expect(out.ok && out.text, input).toBe(want);
  }
});

// A regression here is the conditional compilation guard drifting: a statement outside every `#if` refused for the
// file's directives, or a directive written at column 0 inside a type kept where swift-format indents it.
test("a long statement outside #if is laid out, and a directive off its scope's indent is refused", () => {
  const out = run(
    "struct S {\n  func f() {\n    self.multilineTrailingCommaBehavior = try container.decodeIfPresent(MultilineTrailingCommaBehavior.self, forKey: .x)\n  }\n  #if os(macOS)\n    func g() {}\n  #endif\n}\n",
  );
  expect(out.ok && out.text).toBe(
    "struct S {\n  func f() {\n    self.multilineTrailingCommaBehavior = try container.decodeIfPresent(\n      MultilineTrailingCommaBehavior.self, forKey: .x)\n  }\n  #if os(macOS)\n    func g() {}\n  #endif\n}\n",
  );
  expect(run("struct S {\n  func f() {\n    x()\n  }\n#if os(macOS)\n  func g() {}\n#endif\n}\n").ok).toBe(false);
});

// A regression here is NoAccessLevelOnExtensionDeclaration lost: an extension keeping its access level, or a member
// left without the one it inherits. The expected texts follow the rule's source (Rules/NoAccessLevelOnExtension
// Declaration.swift in the vendored corpus), as swift-format cannot run here; API/Selection.swift is the corpus case.
test("an extension's access level moves onto each member that has none", () => {
  const out = run(
    "public extension A {\n  /// Doc.\n  @inlinable func a() {}\n  static let b = 1\n  private var c: Int { 1 }\n  struct S {\n    func z() {}\n  }\n}\n\nprivate extension B {\n  func d() {}\n}\n\ninternal extension C {\n  func e() {}\n}\n",
  );
  expect(out.ok && out.text).toBe(
    "extension A {\n  /// Doc.\n  @inlinable public func a() {}\n  public static let b = 1\n  private var c: Int { 1 }\n  public struct S {\n    func z() {}\n  }\n}\n\nextension B {\n  fileprivate func d() {}\n}\n\nextension C {\n  func e() {}\n}\n",
  );
});

// A regression here is the ClosureExprSyntax layout lost: a trailing or lone closure argument whose body no longer
// moves onto its own line, or whose `}` stays on the body's line. The cases are the corpus's
// (Rules/UseSynthesizedInitializer.swift, Rules/OrderedImports.swift, Core/Parsing.swift).
test("a long closure argument or trailing closure is broken as swift-format breaks it", () => {
  for (const [input, expected] of [
    [
      "struct S {\n  func f() {\n    let initializersCount = node.memberBlock.members.filter { $0.decl.is(InitializerDeclSyntax.self) }.count\n  }\n}\n",
      "struct S {\n  func f() {\n    let initializersCount = node.memberBlock.members.filter {\n      $0.decl.is(InitializerDeclSyntax.self)\n    }.count\n  }\n}\n",
    ],
    [
      "struct S {\n  func f() {\n    if property.modifiers.contains(where: { $0.name.tokenKind == .keyword(.private) && $0.detail == nil }) {\n      return .private\n    }\n  }\n}\n",
      "struct S {\n  func f() {\n    if property.modifiers.contains(where: {\n      $0.name.tokenKind == .keyword(.private) && $0.detail == nil\n    }) {\n      return .private\n    }\n  }\n}\n",
    ],
    [
      "func f() {\n  let sourceFile = source.withUTF8 { sourceBytes in\n    operatorTable.foldAll(Parser.parse(source: sourceBytes, experimentalFeatures: experimentalFeaturesSet)) { _ in }\n      .as(SourceFileSyntax.self)!\n  }\n}\n",
      "func f() {\n  let sourceFile = source.withUTF8 { sourceBytes in\n    operatorTable.foldAll(\n      Parser.parse(source: sourceBytes, experimentalFeatures: experimentalFeaturesSet)\n    ) { _ in }\n    .as(SourceFileSyntax.self)!\n  }\n}\n",
    ],
  ]) {
    const out = run(input as string);
    expect(out.ok && out.text, input).toBe(expected);
  }
});

// A regression here is DictionaryElementListSyntax's layout lost: a long element of a dictionary broken one element
// per line kept past the width, or broken anywhere but after its `:`. The case is the corpus's
// (Core/RuleNameCache+Generated.swift).
test("a long element of a dictionary broken one per line breaks after its colon", () => {
  const out = run(
    'let ruleNameCache: [ObjectIdentifier: String] = [\n  ObjectIdentifier(AllPublicDeclarationsHaveDocumentation.self): "AllPublicDeclarationsHaveDocumentation",\n  ObjectIdentifier(DoNotUseSemicolons.self): "DoNotUseSemicolons",\n]\n',
  );
  expect(out.ok && out.text).toBe(
    'let ruleNameCache: [ObjectIdentifier: String] = [\n  ObjectIdentifier(AllPublicDeclarationsHaveDocumentation.self):\n    "AllPublicDeclarationsHaveDocumentation",\n  ObjectIdentifier(DoNotUseSemicolons.self): "DoNotUseSemicolons",\n]\n',
  );
});

// A regression here is MatchingPatternConditionSyntax or TupleExprSyntax lost: a `case` condition split at its
// pattern's commas, or a tuple value not broken as a block. The cases are the corpus's
// (Rules/UseShorthandTypeNames.swift, Rules/NeverUseImplicitlyUnwrappedOptionals.swift).
test("a long case condition or parenthesized chain is broken as swift-format breaks it", () => {
  for (const [input, expected] of [
    [
      "func f() {\n  guard let arguments = exactlyTwoChildren(of: genericArgumentList),\n    case (.type(let type0Argument), .type(let type1Argument)) = (arguments.0.argument, arguments.1.argument)\n  else {\n    return\n  }\n}\n",
      "func f() {\n  guard let arguments = exactlyTwoChildren(of: genericArgumentList),\n    case (.type(let type0Argument), .type(let type1Argument)) = (\n      arguments.0.argument, arguments.1.argument\n    )\n  else {\n    return\n  }\n}\n",
    ],
    [
      "struct S {\n  func f() {\n    for attribute in node.attributes {\n      if (attribute.as(AttributeSyntax.self))?.attributeName.as(IdentifierTypeSyntax.self)?.name.text == \"IBOutlet\" {\n        return\n      }\n    }\n  }\n}\n",
      "struct S {\n  func f() {\n    for attribute in node.attributes {\n      if (attribute.as(AttributeSyntax.self))?.attributeName.as(IdentifierTypeSyntax.self)?.name\n        .text == \"IBOutlet\"\n      {\n        return\n      }\n    }\n  }\n}\n",
    ],
  ]) {
    const out = run(input as string);
    expect(out.ok && out.text, input).toBe(expected);
  }
});

// A regression here is the `else if` header left past the width, or laid out without the `} else ` its line opens
// with. The case is the corpus's (Rules/DontRepeatTypeInStaticProperties.swift).
test("a long else-if header is broken as swift-format breaks it", () => {
  const out = run(
    "struct S {\n  func f() {\n    if let typeAnnotation = bindings.first?.typeAnnotation {\n      return typeAnnotation.type.description\n    } else if let initializerCalledExpression = bindings.first?.initializer?.value.as(FunctionCallExprSyntax.self)?\n      .calledExpression\n    {\n      return nil\n    }\n  }\n}\n",
  );
  expect(out.ok && out.text).toBe(
    "struct S {\n  func f() {\n    if let typeAnnotation = bindings.first?.typeAnnotation {\n      return typeAnnotation.type.description\n    } else if let initializerCalledExpression = bindings.first?.initializer?.value.as(\n      FunctionCallExprSyntax.self)?\n      .calledExpression\n    {\n      return nil\n    }\n  }\n}\n",
  );
});

// A regression here is a protocol's where clause, a metatype parameter or a parenthesized return type laid out
// otherwise than swift-format. The cases are the corpus's (Core/SyntaxTraits.swift).
test("a long protocol header or function signature with metatypes is broken as swift-format breaks it", () => {
  for (const [input, expected] of [
    [
      "protocol CommaSeparatedListSyntaxProtocol: SyntaxCollection where Element: WithTrailingCommaSyntax & Equatable {\n  var x: Int { get }\n}\n",
      "protocol CommaSeparatedListSyntaxProtocol: SyntaxCollection\nwhere Element: WithTrailingCommaSyntax & Equatable {\n  var x: Int { get }\n}\n",
    ],
    [
      "extension Syntax {\n  func asProtocol(_: KeywordModifiedExprSyntaxProtocol.Protocol) -> KeywordModifiedExprSyntaxProtocol? {\n    return nil\n  }\n}\n",
      "extension Syntax {\n  func asProtocol(_: KeywordModifiedExprSyntaxProtocol.Protocol)\n    -> KeywordModifiedExprSyntaxProtocol?\n  {\n    return nil\n  }\n}\n",
    ],
    [
      "extension Syntax {\n  func asProtocol(_: (any CommaSeparatedListSyntaxProtocol).Protocol) -> (any CommaSeparatedListSyntaxProtocol)? {\n    return nil\n  }\n}\n",
      "extension Syntax {\n  func asProtocol(_: (any CommaSeparatedListSyntaxProtocol).Protocol) -> (\n    any CommaSeparatedListSyntaxProtocol\n  )? {\n    return nil\n  }\n}\n",
    ],
  ]) {
    const out = run(input as string);
    expect(out.ok && out.text, input).toBe(expected);
  }
});

// A regression here is UseLetInEveryBoundCaseVariable lost: a case pattern keeping its leading `let`. The expected
// texts follow the rule's source (Rules/UseLetInEveryBoundCaseVariable.swift in the vendored corpus);
// PrettyPrint/TokenStreamCreator.swift is the corpus case.
test("a case pattern's let moves onto each identifier it binds", () => {
  const out = run(
    "func f() {\n  switch t {\n  case let .break(kind, _, _):\n    if case let .close(mustBreak) = kind {\n      x()\n    }\n  default: ()\n  }\n  guard case let .comment(c1, false) = n, case let (a, .b(c)) = x else { return }\n}\n",
  );
  expect(out.ok && out.text).toBe(
    "func f() {\n  switch t {\n  case .break(let kind, _, _):\n    if case .close(let mustBreak) = kind {\n      x()\n    }\n  default: ()\n  }\n  guard case .comment(let c1, false) = n, case (let a, .b(let c)) = x else { return }\n}\n",
  );
});

// A regression here is a case label's layout or a block comment within a line lost: the items broken elsewhere than
// after a comma, or the comment counted at its own length (swift-format counts one more). The case is the corpus's
// (PrettyPrint/Comment.swift).
test("a long case label with block comments among its items is broken as swift-format breaks it", () => {
  const out = run(
    'extension A {\n  var isWhitespace: Bool {\n    switch self {\n    case UInt8(ascii: " "), UInt8(ascii: "\\n"), UInt8(ascii: "\\t"), UInt8(ascii: "\\r"), /*VT*/ 0x0B, /*FF*/ 0x0C:\n      return true\n    default:\n      return false\n    }\n  }\n}\n',
  );
  expect(out.ok && out.text).toBe(
    'extension A {\n  var isWhitespace: Bool {\n    switch self {\n    case UInt8(ascii: " "), UInt8(ascii: "\\n"), UInt8(ascii: "\\t"), UInt8(ascii: "\\r"), /*VT*/\n      0x0B, /*FF*/ 0x0C:\n      return true\n    default:\n      return false\n    }\n  }\n}\n',
  );
});
