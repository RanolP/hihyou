import { expect, test } from "vitest";
import { parseTree } from "../../core/index.js";
import { highlight } from "./highlight.js";
import { language } from "./index.js";

const SNIPPET = `/* note */
@media screen and (min-width: 600px) {
  :root { --gap: 4px; }
  #id.box:hover::before, a[href^="x"] > * {
    margin: var(--gap) 1.5em !important;
    color: #fff;
  }
}
@keyframes spin { from { top: 0; } to { top: 1px; } }
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

// A regression here is the later-rule-wins order broken: a pseudo-class or pseudo-element would keep the generic
// `@property` or `@tag` its kind gets earlier in highlights.scm, and a custom property the `@variable` before it.
test("a specific rule wins over the generic one before it", () => {
  expect(got.get("class_name box")).toBe("entity.other.attribute-name.class.css");
  expect(got.get("class_name hover")).toBe("entity.other.attribute-name.pseudo-class.css");
  expect(got.get("tag_name before")).toBe("entity.other.attribute-name.pseudo-element.css");
  expect(got.get("property_name --gap")).toBe("support.type.property-name.css");
});

// A regression here is a `#match?` predicate ignored: every value a variable, or `--gap` in `var()` plain text.
test("a #match? predicate gates its rule on the node's text", () => {
  expect(got.get("plain_value --gap")).toBe("variable.css");
  expect(scopes("a { b: c; }").get("plain_value c")).toBeUndefined();
});

// A regression here is grammar.patch's query hunk lost: `and` is a named node in the patched grammar, so the
// upstream `"and"` pattern would match nothing.
test("media query keywords are operators", () => {
  expect(got.get("and and")).toBe("keyword.operator.logical.and.media.css");
  expect(scopes("@media not print {}").get("not not")).toBe("keyword.operator.logical.not.media.css");
});

// A regression here is a capture name with no TextMate mapping, or a byKind/byText refinement not applied.
test("keywords, literals and punctuation get their TextMate scopes", () => {
  expect(got.get("comment /* note */")).toBe("comment.block.css");
  expect(got.get("@media @media")).toBe("keyword.control.at-rule.css");
  expect(got.get("feature_name min-width")).toBe("support.type.property-name.media.css");
  expect(got.get("id_name id")).toBe("entity.other.attribute-name.id.css");
  expect(got.get("attribute_name href")).toBe("entity.other.attribute-name.css");
  expect(got.get('string_value "x"')).toBe("string.quoted.double.css");
  expect(got.get("universal_selector *")).toBe("entity.name.tag.wildcard.css");
  expect(got.get("> >")).toBe("keyword.operator.combinator.css");
  expect(got.get("function_name var")).toBe("support.function.misc.css");
  expect(got.get("float_value 1.5em")).toBe("constant.numeric.css");
  expect(got.get("unit em")).toBe("keyword.other.unit.css");
  expect(got.get("important !important")).toBe("keyword.other.important.css");
  expect(got.get("color_value #fff")).toBe("constant.other.color.rgb-value.hex.css");
  expect(got.get("from from")).toBe("entity.other.keyframe-offset.css");
  expect(got.get("; ;")).toBe("punctuation.terminator.rule.css");
  expect(got.get("{ {")).toBe("punctuation.section.property-list.begin.bracket.curly.css");
});
