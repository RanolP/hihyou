import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { oxfmt } from "../../fmt/conformance/references.node.js";
import { format } from "../../fmt/format.js";
import { type GraphqlOptions, graphql } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with oxfmt 0.70.0 over prettier's defaults, and with bracketSpacing off (an object value's spaces).
// prettier's own graphql fixtures are the graphql@oxfmt conformance target; these pin what they reach only in part.

const optionSets: [string, Partial<GraphqlOptions>][] = [
  ["defaults", {}],
  ["bracketSpacing false, printWidth 40", { bracketSpacing: false, printWidth: 40 }],
];

const edgeCases: [string, string][] = [
  // A comma is whitespace: dropped from a broken list, written as `, ` in a flat one.
  ["commas", "{ a, b, c }\nquery { a(x: 1, y: 2,) b(x: [1,2,], y: {a: 1,}) }"],
  // A comment after a comma attached to the comma, which prints nothing, and was lost.
  ["comment-after-comma", "query (\n  $a: String, # c\n  $b: Int # d\n) { a }"],
  // A comment between an `implements` list and the fields went to the list node, which prints item by item.
  ["comment-before-fields", "type T implements A & B\n# c\n{ a: Int }"],
  ["comments-in-lists", "{ a(x: 1 # c\n, y: 2) }\n{ a(\n # lead\n x: 1) }\n{ a(x: [ # c\n 1]) }\ntype T {\n  # c\n  a: Int # t\n  # end\n}"],
  ["prettier-ignore", "{\n  # prettier-ignore\n  hero {\n       name\n  }\n  b\n}"],
  // A quoted string prints its decoded value re-escaped; a block string its dedented lines.
  ["strings", '{ a(s: "\\u0041\\n\\"q\\"\\\\", t: """  x  """) }\n"""\n  a\n    b\n"""\ntype T { a: Int }'],
  ["descriptions", 'type T { f("desc" a: Int, """block""" b: Int): Int }\n"d" scalar S\n"d" query Q("v" $a: Int) { a }'],
  ["directives", "query Q @a(x: 1) @b(y: 2) @c(z: 3) @d(w: 4) @e(v: 5) @f(u: 6) @g(t: 7) { a @a @b @c(x: 1) }"],
  ["union", "union U @d = A | B\nunion V =\n| A\n| B\nunion Uuuuuuuuuuuuuuuuuuuuuuu = Aaaaaaaaaaaaaaaa | Bbbbbbbbbbbbbbbbbbbb | Ccccccccccccccccccccc"],
  ["implements", "type Tttttttttttttttttttttttt implements & Aaaaaaaaaaaaaaaaa & Bbbbbbbbbbbbbbbbbbbbbbb & Ccccccccccccccc { a: Int }"],
  ["directive-definition", "directive @d(a: Int = 1 @x) @y repeatable on | FIELD | QUERY\nextend directive @d @z"],
  ["schema", "extend schema @d\nextend schema { query: Q }\nschema @d { query: Q mutation: M }"],
  ["fragments", "fragment F($a: Int) on T @d { a }\n{ ...F(a: 1) @d ... @include(if: true) { a } ... on T { b } }"],
  ["blank-lines", "# head\n\n{ a\n\n\n b }\n\n\n{ c }\n# tail\n"],
];

function ours(text: string, options: Partial<GraphqlOptions>) {
  const tree = parseTree(language, text);
  const out = format(tree, graphql, options);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  const problem = check(graphql, text, out.text);
  if (problem) throw new Error(`check: ${problem}`);
  return out.text;
}
const theirs = (text: string, options: Partial<GraphqlOptions>) => oxfmt.format("x.graphql", text, options);

describe.each(optionSets)(
  "a GraphQL file lays out byte-identical to oxfmt 0.70.0 (%s), so the reviewer sees the layout their tools write",
  (_, options) => {
    it.each(edgeCases)("%s", async (_, text) => {
      expect(ours(text, options)).toBe(await theirs(text, options));
    });
  },
);
