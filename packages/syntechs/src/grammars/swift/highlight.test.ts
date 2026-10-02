import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const SNIPPET = `/// Doc
@MainActor
struct Point<T> {
  var x: Int = 0x1F
  func move(by d: Double) -> Point? {
    for i in 0..<3 { if x == 1 { return nil } }
    let s = "a\\(x)b\\n"
    _ = Foo.bar(label: true ? 1.5 : 2)
    return self
  }
}
`;

/** Each leaf, and each node a rule scopes, as `text scope` in source order. */
function scopes(text: string): Map<string, string | undefined> {
  const tree = parseTree(language, text);
  const out = new Map<string, string | undefined>();
  const walk = (n: number) => {
    const scope = highlight.scopeOf(tree, n);
    const key = `${tree.kindName(n)} ${tree.text(n)}`;
    if (scope !== undefined && !out.has(key)) out.set(key, scope);
    for (let i = 0; i < tree.count(n); i++) walk(tree.child(n, i));
  };
  walk(tree.root);
  return out;
}

const got = scopes(SNIPPET);

// A regression here is the later-rule-wins order broken: a declaration's or a call's name would fall back to the
// generic `variable` rule that precedes its specific one in highlights.scm.
test("a specific rule wins over the generic one before it", () => {
  expect(got.get("simple_identifier move")).toBe("entity.name.function.swift");
  expect(got.get("simple_identifier bar")).toBe("entity.name.function.swift");
  expect(got.get("simple_identifier label")).toBe("variable.other.member.swift");
  expect(got.get("simple_identifier by")).toBe("variable.parameter.swift");
});

// A regression here is a parent-chain or field check misread: an anonymous token scoped wherever its text
// appears (every `:` a ternary operator, every `for`/`in` a loop keyword).
test("a token's scope depends on the node it sits in", () => {
  expect(got.get(": :")).toBe("punctuation.separator.swift");
  expect(scopes("let a = b ? c : d\n").get(": :")).toBe(
    "keyword.operator.ternary.swift",
  );
  expect(got.get("in in")).toBe("keyword.control.loop.swift");
});

// A regression here is a `#match?` predicate ignored: every `//` comment documentation, every capitalised
// receiver not a type.
test("a #match? predicate gates its rule on the node's text", () => {
  expect(got.get("comment /// Doc")).toBe("comment.block.documentation.swift");
  expect(scopes("// plain\n").get("comment // plain")).toBe("comment.swift");
  expect(got.get("simple_identifier Foo")).toBe("entity.name.type.swift");
});

// A regression here is a capture name with no TextMate mapping, or named and anonymous kinds of one spelling
// (the `self` token in a self_expression) mixed up.
test("keywords, literals and strings get their TextMate scopes", () => {
  expect(got.get("struct struct")).toBe("storage.type.swift");
  expect(got.get("return return")).toBe("keyword.control.return.swift");
  expect(got.get("nil nil")).toBe("constant.language.swift");
  expect(got.get("hex_literal 0x1F")).toBe("constant.numeric.integer.swift");
  expect(got.get("real_literal 1.5")).toBe("constant.numeric.float.swift");
  expect(got.get("str_escaped_char \\n")).toBe(
    "constant.character.escape.swift",
  );
  expect(got.get("\\( \\(")).toBe("punctuation.section.embedded.swift");
  expect(got.get("self_expression self")).toBe("variable.language.swift");
  expect(got.get("self self")).toBeUndefined();
  expect(got.get("type_identifier MainActor")).toBe(
    "storage.modifier.attribute.swift",
  );
});
