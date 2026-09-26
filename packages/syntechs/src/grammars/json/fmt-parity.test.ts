import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { format } from "../../fmt/format.js";
import { type JsonOptions, jsonLanguageFor } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with prettier 3.9.9 at its defaults. Not covered, because prettier's comment handlers move
// tokens there: a comment between a key and its value (`{"a": // c\n1}`), and a block comment between an
// array item and its comma on a broken line. Nor is an exponent with a `+` (`1e+5`): tree-sitter-json 0.24.8
// rejects it, so its list keeps the source text. Nor, as `divergences` below pins, a trailing comma (tree-sitter
// repairs it, so its list keeps the source text, where prettier drops the comma) or a JSDoc-style block comment
// (prettier re-indents its ` *` lines).

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

async function ours(
  path: string,
  text: string,
  options: Partial<JsonOptions> = {},
) {
  const tree = parseTree(language, text);
  const lang = jsonLanguageFor(path);
  const out = format(tree, lang, options);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  const problem = check(lang, text, out.text);
  if (problem) throw new Error(`check: ${problem}`);
  return out.text;
}

describe("a JSON file lays out byte-identical to prettier 3.9.9, so the reviewer sees the layout their tools write", () => {
  it.each(corpus())("%s", async (path, text) => {
    expect(await ours(path, text)).toBe(
      await prettier.format(text, { filepath: path }),
    );
  });
});

const nested = `{"a":{"b":1},"c":[${numbers(30)}, "x"],\n"d":{\n"e":[1,2]}}`;
const withOptions: [string, string, Partial<JsonOptions>][] = [
  ["x.json", numbers(30), { printWidth: 40 }],
  ["x.json", nested, { printWidth: 120 }],
  ["x.json", nested, { tabWidth: 4 }],
  ["x.json", nested, { useTabs: true }],
  ["x.json", nested, { useTabs: true, tabWidth: 8, printWidth: 40 }],
  ["x.json", nested, { endOfLine: "crlf" }],
  ["x.json", nested, { endOfLine: "cr" }],
  ["x.json", nested.replaceAll("\n", "\r\n"), { endOfLine: "auto" }],
  ["x.json", "/* a\r\n b */\r\n{}", { endOfLine: "lf" }],
  ["x.jsonc", "// a\n/* b\n c */\n{}", { endOfLine: "crlf" }],
  ["x.json", nested, { bracketSpacing: false }],
  ["x.json", nested, { objectWrap: "collapse" }],
  ["x.jsonc", nested, { trailingComma: "none" }],
  ["x.jsonc", nested, { trailingComma: "es5" }],
  ["package.json", nested, { bracketSpacing: false, objectWrap: "collapse" }],
];

describe("a prettier option lays out as prettier applies it to JSON, so a repo's .prettierrc shows as its tools write", () => {
  it.each(withOptions)("%s %j %j", async (path, text, options) => {
    expect(await ours(path, text, options)).toBe(
      await prettier.format(text, { filepath: path, ...options }),
    );
  });
});

// Input, then today's output, which differs from prettier's.
const divergences: [string, string, string][] = [
  // tree-sitter-json inserts a missing value after the comma, so the list keeps its source text.
  ["trailing-comma-array.json", "[1,2,]", "[1,2,]\n"],
  ["trailing-comma-array.jsonc", "[\n  1,\n  2,\n]", "[\n  1,\n  2,\n]\n"],
  // tree-sitter-json wraps the comma in an ERROR, so the inner object keeps its source text.
  [
    "tsconfig.json",
    '{"compilerOptions": {"strict": true,}, "include": ["src"]}',
    '{ "compilerOptions": {"strict": true,}, "include": ["src"] }\n',
  ],
  // Prettier re-indents a block comment whose lines all start with `*`; its source text stays here.
  [
    "jsdoc.json",
    '/**\n   * doc\n   */\n{"a":1}',
    '/**\n   * doc\n   */\n{ "a": 1 }\n',
  ],
];

describe("a known gap from prettier stays pinned, so closing one shows up as a test change", () => {
  it.each(divergences)("%s", async (path, text, pinned) => {
    expect(await ours(path, text)).toBe(pinned);
    expect(await prettier.format(text, { filepath: path })).not.toBe(pinned);
  });
});
