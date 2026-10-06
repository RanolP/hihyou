import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const SNIPPET = `<!DOCTYPE html>
<!-- note -->
<p class="a" id='b' hidden>x<br/></p>
<div></b></div>
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

// A regression here is a capture name with no TextMate mapping: a tag, attribute or value left unpainted.
test("tags, attributes, values, the doctype and comments get their TextMate scopes", () => {
  expect(got.get("tag_name p")).toBe("entity.name.tag.html");
  expect(got.get("attribute_name class")).toBe(
    "entity.other.attribute-name.html",
  );
  expect(got.get("attribute_name hidden")).toBe(
    "entity.other.attribute-name.html",
  );
  expect(got.get("attribute_value a")).toBe("string.quoted.html");
  expect(got.get("attribute_value b")).toBe("string.quoted.html");
  expect(got.get("doctype <!DOCTYPE html>")).toBe(
    "meta.tag.metadata.doctype.html",
  );
  expect(got.get("comment <!-- note -->")).toBe("comment.block.html");
  expect(got.get("erroneous_end_tag_name b")).toBe(
    "invalid.illegal.unrecognized-tag.html",
  );
});

// A regression here is the `byText` refinement dropped: every bracket of a tag scoped as its opening one.
test("a tag's opening and closing brackets get distinct scopes", () => {
  expect(got.get("< <")).toBe("punctuation.definition.tag.begin.html");
  expect(got.get("</ </")).toBe("punctuation.definition.tag.begin.html");
  expect(got.get("> >")).toBe("punctuation.definition.tag.end.html");
  expect(got.get("/> />")).toBe("punctuation.definition.tag.end.html");
});
