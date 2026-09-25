import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createSyntaxParser } from "@hihyou/engine";
import { nodeGrammarLocator } from "@hihyou/engine/node";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { format } from "../format.js";
import { jsonLanguageFor } from "./index.js";

// Byte parity with prettier 3.9.9 at its defaults. Not covered, because prettier's comment handlers move
// tokens there: a comment between a key and its value (`{"a": // c\n1}`), and a block comment between an
// array item and its comma on a broken line. Nor is an exponent with a `+` (`1e+5`): tree-sitter-json 0.24.8
// rejects it, so its list keeps the source text.

const parser = createSyntaxParser({ locateGrammar: nodeGrammarLocator });

const numbers = (n: number) =>
  `[${Array.from({ length: n }, (_, i) => i * 37).join(",")}]`;
const edgeCases: [string, string][] = [
  ["empty-object.json", "{}"],
  ["empty-array.json", "[ ]"],
  ["empty-broken.json", "{\n}"],
  ["nested-empty.json", '{"a":{},"b":[]}'],
  ["short-array.json", "[1, 2,3]"],
  ["long-numbers.json", numbers(60)],
  ["long-numbers-blank.json", "[1,2,\n\n3,4]"],
  [
    "long-strings.json",
    `[${Array.from({ length: 12 }, (_, i) => `"string number ${i}"`).join(",")}]`,
  ],
  ["matrix.json", "[[1,2],[3,4]]"],
  ["matrix-singletons.json", "[[1],[2]]"],
  ["objects-in-array.json", '[{"a":1,"b":2},{"c":3,"d":4}]'],
  ["mixed-lists.json", '[[1,2],{"a":1,"b":2}]'],
  ["kept-expanded.json", '{\n"a":1,"b":[1,2]}'],
  ["collapsed.json", '{"a":1,\n"b":2}'],
  ["blank-lines.json", '{"a":1,\n\n\n"b":2,\n"c":[\n1,\n\n2]}'],
  ["blank-lines-strings.json", '["a",\n\n"b"]'],
  ["long-line.json", `{"key":"${"x".repeat(90)}","k2":1}`],
  ["fits-exactly.json", `{"k":"${"x".repeat(69)}"}`],
  ["one-over.json", `{"k":"${"x".repeat(70)}"}`],
  ["numbers.json", "[1E5,1.50,0.50e01,-0.0,10,1e-07,5.0,0.5E-0]"],
  ["strings.json", '["\\u00e9\\/x","tab\\t","quote\\""]'],
  ["unicode.json", `{"한국어":"${"값".repeat(30)}","e":"😀😀"}`],
  ["unicode-fit.json", `{"k":"${"값".repeat(34)}"}`],
  // One string per width class, each sized so that a wrong width moves it across the 80th column: a text-style
  // emoji prettier counts as 2 (✌), a narrow emoji it counts as 1 (©), Tangut (1 in the width table prettier
  // bundles, 2 in newer ones), fullwidth Latin, and a combining accent (0).
  ["width-emoji-text-style.json", `{"k":"${"✌".repeat(35)}"}`],
  ["width-emoji-narrow.json", `{"k":"${"©".repeat(69)}"}`],
  ["width-tangut.json", `{"k":"${"\u{17000}".repeat(69)}"}`],
  ["width-fullwidth.json", `{"k":"${"Ａ".repeat(35)}"}`],
  ["width-combining.json", `{"k":"${"é".repeat(69)}"}`],
  ["deep.json", '{"a":{"b":{"c":{"d":[1,{"e":null,"f":true,"g":false}]}}}}'],
  ["scalar.json", "  42  "],
  ["line-comment.jsonc", '{\n  // lead\n  "a": 1, // trail\n  "b": 2\n}'],
  ["block-comment.jsonc", '{"a": 1 /* after */, /* before */ "b": 2}'],
  ["dangling-block.jsonc", "{/* d */}"],
  ["dangling-two.jsonc", "[/* a */ /* b */]"],
  ["dangling-line.jsonc", "[ // x\n]"],
  ["file-comments.jsonc", '// top\n\n{"a":1}\n// bottom\n'],
  ["own-line-last.jsonc", '{\n"a":1\n// end\n}'],
  ["array-comments.jsonc", "[\n  1, // one\n  2,\n  // before three\n  3\n]"],
  ["comment-blank-before.jsonc", '{\n"a":1,\n\n// c\n"b":2}'],
  ["trailing-spaces.jsonc", '{"a":1} // c   \n'],
  ["concise-line-comment.json", "[1, // one\n2, 3]"],
  ["concise-leading-comment.json", "[1,\n// two\n2, 3]"],
  ["concise-block-comment.json", "[1 /* a */, 2]"],
  ["crlf.json", '{\r\n"a": 1,\r\n\r\n"b": [1,\r\n\r\n2]\r\n}'],
  ["tabs.json", '{\t"a":\t1}'],
  ["jsonc-dangling.jsonc", '{"a":[],"b":[/* c */]}'],
  ["jsonc-last-comment.jsonc", '{\n"a":1, "b":2 // c\n}'],
  ["jsonc-matrix.jsonc", "[[1,2],[3,4]]"],
  // Lists that end near the 80th column, where a trailing comma decides whether the last item fits.
  ...Array.from({ length: 12 }, (_, i): [string, string] => [
    `fill-${i}.jsonc`,
    `{"k":[${Array.from({ length: 20 + i }, (_, j) => j + 1).join(",")}]}`,
  ]),
  ...Array.from({ length: 6 }, (_, i): [string, string] => [
    `width-${i}.jsonc`,
    `{"key":"${"v".repeat(66 + i)}"}`,
  ]),
  [
    "package.json",
    '{"name":"x","files":[],"keywords":["a","b"],"n":1.50,\n\n"o":{}}',
  ],
  ["composer.json", '{"require":{"php":">=8"}}'],
];

function corpus(): [string, string][] {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const files = execFileSync("git", ["ls-files", "*.json"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  return [
    ...files.map((f): [string, string] => [
      f,
      readFileSync(`${root}/${f}`, "utf8"),
    ]),
    ...edgeCases,
  ];
}

describe("a JSON file lays out byte-identical to prettier 3.9.9, so the reviewer sees the layout their tools write", () => {
  it.each(corpus())("%s", async (path, text) => {
    const expected = await prettier.format(text, { filepath: path });
    const tree = await parser.parse("json", text);
    const root = tree.nodes[0];
    if (!root) throw new Error("empty tree");
    const out = format(root, text, jsonLanguageFor(path));
    if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
    expect(out.text).toBe(expected);
  });
});
