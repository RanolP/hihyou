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

// A regression here is an unported construct laid out anyway: a member after a call's arguments (`f(x).y`, where
// swift-format puts `)` on its own line) or a closure argument.
test("a long line whose layout is not ported is refused", () => {
  for (const input of [
    "func f() {\n  try aaaaaaaaaaaaaaaaaaa.encode(bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, forKey: .ccccccccccccccccccccccccc).dddd()\n}\n",
    "let a = bbbbbbbbbbbbbbbbbbbbbbbb.map { $0.cccccccccccccccccccccccccccccc(dddddddddddddddddddddddddddddddd) }\n",
  ])
    expect(run(input).ok, input).toBe(false);
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
