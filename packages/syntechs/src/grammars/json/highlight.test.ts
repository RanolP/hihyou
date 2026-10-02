import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const SNIPPET = `// line
{
  "key": "va\\nlue",
  /* block */
  "n": [1.5, true, false, null]
}
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

// A regression here is highlights.tm.scm dropped or reordered: under later-pattern-wins, upstream's
// `(string) @string` would paint every key as a value string.
test("a key gets the property-name scope, a value the string scope", () => {
  expect(got.get('string "key"')).toBe("support.type.property-name.json");
  expect(got.get('string "va\\nlue"')).toBe("string.quoted.double.json");
  expect(got.get("escape_sequence \\n")).toBe("constant.character.escape.json");
});

// A regression here is a capture with no TextMate mapping, or the comment prefix refinement lost.
test("literals and comments get their TextMate scopes", () => {
  expect(got.get("number 1.5")).toBe("constant.numeric.json");
  expect(got.get("true true")).toBe("constant.language.json");
  expect(got.get("null null")).toBe("constant.language.json");
  expect(got.get("comment // line")).toBe("comment.line.double-slash.json");
  expect(got.get("comment /* block */")).toBe("comment.block.json");
});
