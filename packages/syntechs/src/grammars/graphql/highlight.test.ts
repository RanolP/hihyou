import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const SNIPPET = `# c
"""doc"""
type T implements I { f(a: Int = 1): [String!] @deprecated }
query Q($v: Boolean = true) { alias: f(a: 1.5, s: "x") ...F }
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

// A regression here is the GraphQL captures unmapped: a type, a field or a variable left unscoped.
test("types, fields and variables get their TextMate scopes", () => {
  expect(got.get("name T")).toBe("entity.name.type.graphql");
  expect(got.get("name Int")).toBe("entity.name.type.graphql");
  expect(got.get("name alias")).toBe("variable.other.property.graphql");
  expect(got.get("name Q")).toBe("variable.other.graphql");
});

// A regression here is the comment capture's byKind refinement ignored: a description painted as a comment.
test("a comment and a description are told apart", () => {
  expect(got.get("comment # c")).toBe("comment.line.number-sign.graphql");
  expect(got.get('description """doc"""')).toBe("string.quoted.double.graphql");
});

test("literals get their scopes", () => {
  expect(got.get("float_value 1.5")).toBe("constant.numeric.graphql");
  expect(got.get("boolean_value true")).toBe("constant.language.boolean.graphql");
});
