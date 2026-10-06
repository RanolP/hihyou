import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const SNIPPET = `--- # doc
plain: value
"quoted": 'single'
n: 1.5
i: 42
t: true
z: null
a: &anchor !tag {k: v, m: [1, 2]}
b: *anchor
c: |
  block
...
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

// A regression here is the later-rule-wins order broken: a mapping key would stay the generic string the
// `@string` rule before the `@property` ones paints it.
test("a mapping key wins over the string rule before it", () => {
  expect(got.get("string_scalar plain")).toBe("entity.name.tag.yaml");
  expect(got.get('double_quote_scalar "quoted"')).toBe("entity.name.tag.yaml");
  expect(got.get("string_scalar k")).toBe("entity.name.tag.yaml");
  expect(got.get("string_scalar value")).toBe("string.unquoted.plain.out.yaml");
  expect(got.get("string_scalar v")).toBe("string.unquoted.plain.out.yaml");
  expect(got.get("single_quote_scalar 'single'")).toBe("string.quoted.single.yaml");
});

// A regression here is a capture's byKind or byText refinement ignored: every number an integer, every
// anchor-or-alias one scope, every punctuation token one separator.
test("scalars, anchors and punctuation get their TextMate scopes", () => {
  expect(got.get("float_scalar 1.5")).toBe("constant.numeric.float.yaml");
  expect(got.get("integer_scalar 42")).toBe("constant.numeric.integer.yaml");
  expect(got.get("boolean_scalar true")).toBe("constant.language.boolean.yaml");
  expect(got.get("null_scalar null")).toBe("constant.language.null.yaml");
  expect(got.get("anchor_name anchor")).toBe("entity.name.type.anchor.yaml");
  expect(got.get("alias_name anchor")).toBe("variable.other.alias.yaml");
  expect(got.get("tag !tag")).toBe("storage.type.tag-handle.yaml");
  expect(got.get("comment # doc")).toBe("comment.line.number-sign.yaml");
  expect(got.get(": :")).toBe("punctuation.separator.key-value.mapping.yaml");
  expect(got.get("{ {")).toBe("punctuation.definition.mapping.begin.yaml");
  expect(got.get("] ]")).toBe("punctuation.definition.sequence.end.yaml");
  expect(got.get("& &")).toBe("punctuation.definition.anchor.yaml");
  expect(got.get("--- ---")).toBe("entity.other.document.begin.yaml");
});
