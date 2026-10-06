import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const SNIPPET = `# note
MAX_SIZE = 0x1F
@dataclass
class Point:
    def move(self, d: float) -> "Point":
        for i in range(3):
            if i is not None and Foo.bar(1.5):
                return f"a{i}b\\n"
        x += len('s')
`;

/** Each leaf, and each node a rule scopes, as `text scope` in source order. */
function scopes(text: string): Map<string, string | undefined> {
  const tree = parseTree(language, text);
  const painted = new Map<number, string>();
  highlight.highlight(tree, (n, scope, from) => {
    if (from === undefined) painted.set(n, scope);
  });
  const out = new Map<string, string | undefined>();
  const walk = (n: number) => {
    const scope = painted.get(n);
    const key = `${tree.kindName(n)} ${tree.text(n)}`;
    if (scope !== undefined && !out.has(key)) out.set(key, scope);
    for (let i = 0; i < tree.count(n); i++) walk(tree.child(n, i));
  };
  walk(tree.root);
  return out;
}

const got = scopes(SNIPPET);

// A regression here is the later-rule-wins order broken: a definition's or a call's name would fall back to the
// generic `variable` or `^[A-Z]` constructor rule that precedes its specific one in highlights.scm. A method
// call's name is an attribute too, and upstream's `@property` pattern comes after its `@function.method` one.
test("the later rule wins over the one before it", () => {
  expect(got.get("identifier move")).toBe("entity.name.function.python");
  expect(got.get("identifier bar")).toBe("meta.attribute.python");
  expect(got.get("identifier range")).toBe("support.function.builtin.python");
  expect(got.get("identifier self")).toBeUndefined();
});

// A regression here is a `#match?` predicate ignored: every identifier a constant, or every call a builtin.
test("a #match? predicate gates its rule on the node's text", () => {
  expect(got.get("identifier MAX_SIZE")).toBe("constant.other.caps.python");
  expect(got.get("identifier Foo")).toBeUndefined();
  expect(got.get("identifier d")).toBeUndefined();
  expect(scopes("foo(1)\n").get("identifier foo")).toBe(
    "entity.name.function.python",
  );
});

// A regression here is a capture with no TextMate mapping, or a byKind/byText/byPrefix refinement misread.
test("keywords, operators, literals and strings get their TextMate scopes", () => {
  expect(got.get("comment # note")).toBe("comment.line.number-sign.python");
  expect(got.get("integer 0x1F")).toBe("constant.numeric.hex.python");
  expect(got.get("float 1.5")).toBe("constant.numeric.float.python");
  expect(got.get("decorator @dataclass")).toBe(
    "entity.name.function.decorator.python",
  );
  expect(got.get("class class")).toBe("storage.type.class.python");
  expect(got.get("def def")).toBe("storage.type.function.python");
  expect(got.get("return return")).toBe("keyword.control.flow.python");
  expect(got.get("is not is not")).toBe("keyword.operator.logical.python");
  expect(got.get("+= +=")).toBe("keyword.operator.assignment.python");
  expect(got.get("-> ->")).toBe(
    "punctuation.separator.annotation.result.python",
  );
  expect(got.get("none None")).toBe("constant.language.python");
  expect(got.get('string "Point"')).toBe("string.quoted.double.python");
  expect(got.get("string 's'")).toBe("string.quoted.single.python");
  expect(got.get('string f"a{i}b\\n"')).toBe("string.quoted.double.python");
  expect(got.get("escape_sequence \\n")).toBe(
    "constant.character.escape.python",
  );
  expect(got.get("{ {")).toBe(
    "constant.character.format.placeholder.other.python",
  );
  expect(got.get("identifier float")).toBe("entity.name.type.python");
});
