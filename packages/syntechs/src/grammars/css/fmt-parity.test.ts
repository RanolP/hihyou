import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { format } from "../../fmt/format.js";
import { type CssOptions, css } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with prettier 3.9.9, under its defaults and under a set a person would write in a `.prettierrc`.
// Not covered, as `divergences` below pins: a node tree-sitter-css wraps in an ERROR (it keeps its source
// text), a block comment inside a value (the core attaches it to the value before it, so it never moves to
// the next line the way prettier's fill does), and an empty file.

const optionSets: [string, Partial<CssOptions>][] = [
  ["defaults", {}],
  [
    "singleQuote, tabWidth 4, printWidth 100",
    { singleQuote: true, tabWidth: 4, printWidth: 100 },
  ],
];

const edgeCases: [string, string][] = [
  ["empty-rule", ".a{}"],
  [
    "comments",
    "/* head */\na { color : red ; /* trail */\n  /* lead */\n  b: c }\n\n/* end */\n",
  ],
  ["dangling-comment", "a { /* only */ }"],
  ["blank-lines", "a{b:c;\n\n\nd:e}\n\n\n.f{g:h}"],
  ["important", "a{color:red!important;margin:0 !important}"],
  ["missing-semicolon", "a{b:c}"],
  [
    "multi-value-list",
    "a{transition:opacity .15s linear,transform .3s ease-out;font-family:a,b,c}",
  ],
  [
    "single-word-list",
    "a{font-family:-apple-system,system-ui,Segoe UI,Roboto,Helvetica Neue,Arial}",
  ],
  [
    "box-shadow",
    "a{box-shadow:0 0 0 1px rgba(0,0,0,.1),0 2px 4px rgba(0,0,0,.2)}",
  ],
  ["custom-property", "a{--x:a b,c d;--y:  10px}"],
  [
    "long-value",
    `a{font:italic small-caps bold condensed 16px/2 ${"word ".repeat(16)}serif}`,
  ],
  ["numbers", "a{a:.5em;b:1.50PX;c:10E3;d:+.5;e:0.0;f:1e-07}"],
  ["colors-keywords", "a{color:#ABCDEF;b:INHERIT;C:Red}"],
  ["calc", "a{width:calc(100% - (2*var(--a)));height:calc( 1px + 2px )}"],
  [
    "functions",
    "a{transform:translate(-50%,-50%) rotate(45deg);color:rgba(var(--rgb),.75)}",
  ],
  ["url", 'a{background:url( "a b" ),url(b.png)}'],
  [
    "grid",
    'a{grid-template-areas:"a b"\n  "c d";grid-template-columns:[full-start] 1fr\n  [full-end]}',
  ],
  ["strings", `a{content:"it's";b:'say "hi"';c:'both \\' and "';d:'x'}`],
  [
    "selectors",
    "a>b~c+d e,.f:hover::before,#g[type=text],[class*='col-'],*,svg|a{x:y}",
  ],
  [
    "long-selector-list",
    Array.from({ length: 8 }, (_, i) => `.selector-number-${i}`).join(",") +
      "{x:y}",
  ],
  [
    "long-complex-selector",
    ".very-long-selector-name-number-one .very-long-selector-name-number-two > .very-long-selector-name-number-three{x:y}",
  ],
  [
    "pseudo-args",
    "li:nth-child( 2n+1 ),li:NTH-CHILD(even),.y:is(.a,.b) .z:where(.c),a:not(:first-child){x:y}",
  ],
  [
    "media",
    "@media screen and (-webkit-min-device-pixel-ratio:2),(min-resolution:192dpi){a{b:c}}",
  ],
  ["media-range", "@media (min-width:768px) and (max-width:991.98px){a{b:c}}"],
  ["supports", "@supports not (display:grid){a{b:c}}"],
  [
    "keyframes",
    "@-webkit-keyframes x{from{a:b}50%{c:d}to{e:f}}@keyframes y{0%,to{a:b}}",
  ],
  [
    "import",
    "@charset 'utf-8';@import 'a.css';@import url(a.css) screen , print;",
  ],
  [
    "font-face",
    '@font-face{font-family:x;src:url(a.woff2) format("woff2"),url(a.woff) format("woff")}',
  ],
  ["other-at-rules", "@layer a,b;@container (min-width:400px){a{b:c}}"],
  // An at-rule's params print as raw text, which once dropped the comments attached to them.
  ["at-rule-param-comment", "@counter-style /* c */ thumbs {}"],
  [
    "progid",
    "a{filter:progid:DXImageTransform.Microsoft.gradient(startColorstr='#80000000')}",
  ],
  ["crlf", "a{\r\n  b:c;\r\n  /* x\r\n  y */\r\n\r\n\r\n  d:e\r\n}\r\n"],
  // Front matter once parsed as selectors, lowercased and joined onto the first rule's line.
  ["front-matter", "---\ntitle: Title\n\n---\na{b:c}"],
  ["front-matter-toml", "+++\ntitle = 'T'\n\n+++\n\n\n/* c */"],
];

const corpusDir = join(import.meta.dirname, "../../../corpus");
const corpusFiles = ["normalize.css", "animate.css", "bootstrap.css"];
const present = corpusFiles.every((f) => existsSync(join(corpusDir, f)));

function ours(text: string, options: Partial<CssOptions>) {
  const tree = parseTree(language, text);
  const out = format(tree, css, options);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  const problem = check(css, text, out.text);
  if (problem) throw new Error(`check: ${problem}`);
  return out.text;
}
const theirs = (text: string, options: Partial<CssOptions>) =>
  prettier.format(text, { filepath: "x.css", ...options });

describe.each(optionSets)(
  "a CSS file lays out byte-identical to prettier 3.9.9 (%s), so the reviewer sees the layout their tools write",
  (_, options) => {
    it.each(edgeCases)("%s", async (_, text) => {
      expect(ours(text, options)).toBe(await theirs(text, options));
    });
  },
);

/** Top-level chunks: a new chunk starts at each line that begins in column 0 with anything but `}`. */
const chunks = (s: string) => s.split(/\n(?=[^\s}])/);

// The fetched corpus is gitignored, so this runs where `fetch-corpus.sh` has run. Each count is pinned exactly:
// a regression lowers it, and closing a gap raises it, which shows up as a test change.
const ratchet: [string, Partial<CssOptions>, string, number, number][] = [
  ["defaults", {}, "normalize.css", 96, 96],
  ["defaults", {}, "animate.css", 328, 328],
  ["defaults", {}, "bootstrap.css", 1638, 1641],
  [
    "singleQuote, tabWidth 4, printWidth 100",
    optionSets[1]?.[1] ?? {},
    "normalize.css",
    96,
    96,
  ],
  [
    "singleQuote, tabWidth 4, printWidth 100",
    optionSets[1]?.[1] ?? {},
    "animate.css",
    324,
    328,
  ],
  [
    "singleQuote, tabWidth 4, printWidth 100",
    optionSets[1]?.[1] ?? {},
    "bootstrap.css",
    1639,
    1641,
  ],
];

describe.skipIf(!present)(
  "the fetched CSS corpus keeps its count of chunks byte-identical to prettier, so a layout regression cannot hide in a large file",
  () => {
    it.each(ratchet)("%s: %s", async (_, options, file, identical, total) => {
      const text = readFileSync(join(corpusDir, file), "utf8");
      const a = chunks(ours(text, options));
      const b = chunks(await theirs(text, options));
      const expected = new Set(b);
      expect([a.filter((c) => expected.has(c)).length, b.length]).toEqual([
        identical,
        total,
      ]);
    });
  },
);

// Input, options, then today's output, which differs from prettier's.
const divergences: [string, string, Partial<CssOptions>, string][] = [
  // tree-sitter-css reads `@page :first` as an ERROR, so the rule keeps its source text.
  ["page-pseudo", "@page :first{margin:1in}", {}, "@page :first{margin:1in}\n"],
  // An empty declaration is an ERROR, so the whole block keeps its source text.
  ["double-semicolon", "a{color:red;;}", {}, "a {color:red;;}\n"],
  // tree-sitter-css reads the `%` of a decimal keyframe selector as an ERROR, so the block keeps its source
  // indentation where prettier re-indents it.
  [
    "decimal-keyframe",
    "@keyframes x {\n  6.5% {\n    a: b;\n  }\n}\n",
    { tabWidth: 4 },
    "@keyframes x {\n    6.5% {\n    a: b;\n  }\n}\n",
  ],
  // Prettier moves a block comment after a value to its own line once the value breaks; here it stays attached.
  [
    "value-comment",
    `a{background-image:url("${"x".repeat(60)}") /*rtl:url("${"y".repeat(20)}")*/;}`,
    {},
    `a {\n  background-image: url("${"x".repeat(60)}") /*rtl:url("${"y".repeat(20)}")*/;\n}\n`,
  ],
  // tree-sitter-css reads some `name='#hex'` argument lists of `progid:...()` as an ERROR.
  [
    "progid-arguments",
    "a{filter:progid:X.y(startColorstr='#80000000', endColorstr='#80000000')}",
    {},
    "a {filter:progid:X.y(startColorstr='#80000000', endColorstr='#80000000')}\n",
  ],
  // tree-sitter-css knows only lowercase `!important` and `from`; the uppercase ones are ERRORs.
  [
    "uppercase-important",
    "a{margin:0 !IMPORTANT}",
    {},
    "a {margin:0 !IMPORTANT}\n",
  ],
  [
    "uppercase-from",
    "@keyframes x{FROM{a:b}}",
    {},
    "@keyframes x{FROM{a:b}}\n",
  ],
  // `@MEDIA` parses as a generic at-rule, whose parameters keep their source text.
  [
    "uppercase-media",
    "@MEDIA (min-width:1px){a{b:c}}",
    {},
    "@media (min-width:1px) {\n  a {\n    b: c;\n  }\n}\n",
  ],
  // The core ends every file with a newline; prettier prints an empty file as nothing.
  ["empty-file", "", {}, "\n"],
];

describe("a known gap from prettier stays pinned, so closing one shows up as a test change", () => {
  it.each(divergences)("%s", async (_, text, options, pinned) => {
    expect(ours(text, options)).toBe(pinned);
    expect(await theirs(text, options)).not.toBe(pinned);
  });
});
