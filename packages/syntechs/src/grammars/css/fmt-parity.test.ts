import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { oxfmt } from "../../fmt/conformance/references.node.js";
import { format } from "../../fmt/format.js";
import { type CssOptions, css } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with oxfmt 0.70.0 over prettier's defaults, under those and under a set a person would write in a
// `.prettierrc`.
// Not covered, as `divergences` below pins: a node tree-sitter-css wraps in an ERROR (it keeps its source
// text), and an empty file.

const optionSets: [string, Partial<CssOptions>][] = [
  ["defaults", {}],
  [
    "singleQuote, tabWidth 4, printWidth 100",
    { singleQuote: true, tabWidth: 4, printWidth: 100 },
  ],
];

const edgeCases: [string, string][] = [
  ["empty-rule", ".a{}"],
  ["page-pseudo", "@page :first{margin:1in}"],
  ["attribute-flag", '[type="a"   I]{b:c}'],
  ["double-semicolon", "a{color:red;;}"],
  ["uppercase-important", "a{margin:0 !IMPORTANT;padding:0 !  important}"],
  ["empty-value", ":root{--a:;--b:  ;c:d}"],
  ["ie-hacks", ".a{*zoom:1;_width:2px;+color:red;*+color:red\\9}"],
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
  // The `/` makes the tail a binary expression, which must keep the grid's source lines too.
  ["grid-slash", 'a{grid-template:\n  "a a" 20px\n  "b b" 20px\n  / 1fr 2fr;grid:1fr / auto 1fr}'],
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
  // `@MEDIA` parsed as a generic at-rule, whose parameters kept their source text.
  ["uppercase-media", "@MEDIA screen  and (min-width :1px){a{b:c}}"],
  // `@custom-media` and a range feature were parse errors, printed as raw source.
  [
    "custom-media",
    "@custom-media  --a ( min-width:1PX )  and (  400px<width  <= 700px ) ;@custom-media --b(width>=1px),print;",
  ],
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
  ["other-at-rules", "@container (min-width:400px){a{b:c}}"],
  // A `@layer` list was kept as written; oxfmt spaces it after its commas.
  ["layer-list", "@layer a,b;@layer c , d;@LAYER e\n,f;"],
  // A comment among it printed next to its neighbour, spaced; oxfmt keeps the list as written, each gap one space.
  ["layer-list-comment", "@layer a,/* c */b;@layer a/* c */,b;@LAYER  a,/* c */\n  b , c;@layer /* c */ a,b;"],
  // A paren group in a value lost its gaps, `(1 2)` printing `(12)`.
  ["value-parens", "a{b:foo( (1 ,2) );c:(a  b,c) x (1 2);d:foo((1,2),(3 +4))}"],
  // A custom property's or Sass variable's value holding a paren group was kept as written; oxfmt keeps it only
  // where oxc-css-parser's typed grammar rejects the group, which it takes solely as a calc operand of one sum.
  [
    "custom-property-calc-parens",
    ".card-header-long-selector-name{--bs-card-inner-border-radius:calc(var(--bs-border-radius) - (var(--bs-border-width)));--a:calc( (1px + 2px) * 2 );--b:max( (1px), 2px );$c:fn(calc( (1px) ));--d:fn( (1) );--e:calc( (1px+2px) );--f:calc( (1px, 2px) );--g:-o-calc( (1px) );--h:(1) calc((2))}",
  ],
  // A function's arguments in a value holding a paren group oxc-css-parser rejects broke one per line; oxfmt lays the
  // raw value's tokens out as one fill, where no line breaks after a comma, and keeps the comments among them.
  [
    "raw-value-arguments",
    "a{b: bar(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) foo((1));c: x bar(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, cccccccccccc) foo((1));d: foo(1PX,#FFF,\"x\",(1)) (2);e: foo( a  b,(1),bar( x ,y ));f: calc(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa + bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb + (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))}",
  ],
  // A comment inside a math function's calc sum or group printed in place; oxc's calc printer flushes none, so it
  // prints after the whole argument.
  [
    "math-operand-comment",
    "a{b:calc( (/* c */ 1px) );c:max((/* c */ 1px), 2px);d:calc((1px) /* d */ + (/* c */ 2px));--x:calc(1px /* c */ + 2px)}",
  ],
  // A raw value (one oxc-css-parser rejects) broke before each function and kept function arguments on one line;
  // oxfmt fills its tokens across the arguments too, breaks after each top-level comma, and prints tokens verbatim.
  [
    "raw-value-fill",
    "a{b: x bar(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccc c) foo((1));c: foo(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, (1) cccccccccccccccccccccc);d: foo((1)), bar;e: .50em 1E3 RED 'x' (1)}",
  ],
  // oxc-css-parser splits `a*b` and `a/b` in a raw value into three tokens and prints a space around `*` and a
  // `/` next to a word; syntechs kept the word whole.
  ["raw-value-operator", "a{b:a*b (1);c:a/b (1);d:a*b*c/d 1px/2px (1)}"],
  // oxfmt prints a raw token's comment glued before it and a custom property's value verbatim with its comments;
  // syntechs moved the comma's comment after a space and dropped a custom property's comments.
  ["raw-value-comment", "a{b:foo(a/* c */ ,b) (1);c:foo(a/* c */ ) (1);--x:a/* c */ ,b (1);--y:a (1) /* c */;--z:a (1) /* c */ !important}"],
  // An at-rule's params print as raw text, which once dropped the comments attached to them.
  ["at-rule-param-comment", "@counter-style /* c */ thumbs {}"],
  [
    "progid",
    "a{filter:progid:DXImageTransform.Microsoft.gradient(startColorstr='#80000000')}",
  ],
  // `name='#hex'` pairs, once an ERROR before tree-sitter-css read Sass's `name: value` arguments.
  [
    "progid-arguments",
    "a{filter:progid:X.y(startColorstr='#80000000', endColorstr='#80000000')}",
  ],
  // Sass's argument lists and maps, which printed as written while tree-sitter-css read them as ERRORs.
  [
    "sass-arguments",
    "@mixin m ( $a, $b: 10, $args... ) {}\n@include m(1, $b: (k: v, l: w));\n$map: (a: 1,\n\n b: 2);",
  ],
  // A block comment among a value's words stayed attached to the word before it; prettier's value parser reads it
  // as a word, moved to a line of its own once the value breaks, and an entry holding one breaks the comma list.
  ["value-comment", `a{background-image:url("${"x".repeat(60)}") /*rtl:url("${"y".repeat(20)}")*/;}`],
  ["value-comment-entry", "a{box-shadow:1px 1px red,/* c */ 2px 2px blue;background:a,\n/* c */\nb}"],
  // Comments among a function's arguments or an `@import`'s words took a line each, not a place in the fill.
  [
    "argument-comment",
    'a{transform:translate(/* a */ /* b */ 10px /* c */)}@import /* a */ url("x.css") /* b */ print /* c */, /* d */ tv;',
  ],
  // A value of comments alone is postcss's value, not its `between`, so its source gaps were kept.
  ["comment-only-value", "a{--x:   /* a */    /* b */;--f:/* a */ ;}"],
  // Prettier keeps a selector holding a comment as written; it was laid out as selectors.
  ["selector-comment", ".a /* x */, /* y */ .b /* z */ {}\n.c\n/* w */ {}\na[/* v */x]{b{c/* u */{d:e}}}"],
  ["crlf", "a{\r\n  b:c;\r\n  /* x\r\n  y */\r\n\r\n\r\n  d:e\r\n}\r\n"],
  // Front matter once parsed as selectors, lowercased and joined onto the first rule's line.
  ["front-matter", "---\ntitle: Title\n\n---\na{b:c}"],
  ["front-matter-toml", "+++\ntitle = 'T'\n\n+++\n\n\n/* c */"],
  // A suffixed `&` and a descendant ending in `&` were parse errors, printed as raw source.
  ["nesting-suffix", ".a{&__b,&-c{d:e}.f &{g:h}}"],
  // A Sass `$variable`, declared or read, was a parse error, printed as raw source.
  ["sass-variable", "$a:RGB(0,0,0);.b{border:1px solid $a;$c:d}"],
  // A value opening with an operator, and a custom property holding a `{...}` group, were ERROR nodes kept as written.
  [
    "signed-operands",
    'a{p:1 -(-1) + 20px;q:-1*-(-1);c:color(red alpha(- .75) hue(*20));--j:[1,{"a":1}];--f:fn(x) { go(x) };}',
  ],
  // A rule or declaration after a prettier-ignore comment was laid out like any other.
  [
    "prettier-ignore",
    "/* prettier-ignore */\n.a  >  .b{}\n.c{\n  /* prettier-ignore */\n  d:     e;\n  f:g}",
  ],
  // A `//` in a value was a line comment that swallowed the rest of the line, its `;` included.
  [
    "double-slash-value",
    "a{b:a // c;d:1px //2px;e:a//c;f:calc(1px // c\n+ 2px);g:fn(a // b);h:a, // c\n d;i:a //c //d}",
  ],
  // An empty comma group (`a,,b`) was an ERROR kept as written.
  ["empty-comma-group", "a{b:a,,(1);c:a, ,b;d:x,,,y;--e:a,,b}"],
  // A `:` in a value was one word with its neighbours (`a:b`) or, spaced, an ERROR kept as written.
  [
    "value-colon",
    'a{b:a:b (1);c:a :b;d:1px:2px;e:a::b;f:x(a:b);g:"a":b, c;h:x(http://a);filter:progid:DX.a(b=1);--i:a :b}',
  ],
  // A math chain after other words was one item of the entry's fill, so the fill broke before its first operand.
  [
    "math-chain-in-fill",
    `a{b:${"x ".repeat(36)}// c;d:${"x ".repeat(37)}/ c;e:${"x ".repeat(37)}* c;f:${"x ".repeat(30)}// c // d // e // f}`,
  ],
  // A word CSS Syntax lexes as an ident then more tokens (`a/c`) counted as one value, so its list stayed packed.
  ["ident-then-more-list", "a{b:a/c, d;c:d, a-b/c;e:a%c, d;f:a/c,d/e;g:U+0-7F, a}"],
  // An entry opening with a `+` or `-` broke the list; oxfmt breaks at a lone `-ident` past the first entry only.
  ["signed-entry-list", "a{b:a, -1;c:a,, -1;d:-b, a;e:a, -1px, -f(), --g;h:a, -b}"],
  // A value opening or ending with a `,` was an ERROR kept as written.
  ["edge-commas", "a{b:a,;c:a b,;d:,;e:a,!important;f:a:b,;--g:a,;h:,a;i:,a b;j:,,a}"],
  // A word CSS Syntax lexes with a delim oxc-css-parser's typed grammar rejects (`a*c`, `a%c`) was typed, so `*`
  // stayed glued and a `/` elsewhere in the value kept its source gaps; oxc reads the whole value as raw tokens.
  ["delim-word-raw", "a{b:a*c;c:a%c,d/e;d:a.c,d/e;e:f(a%c),d/e;f:a*c, d}"],
  // A `#name` or `$name` glued to a word (`a#b`) and a `*` in a function's word stayed glued; oxc lexes them as
  // tokens of their own and spaces them, but in `url(…)`, a math function, and Tailwind's `w-*`.
  // `a/f(c)` is the word `a/f` then a group to tree-sitter-css, which made the value raw and spaced its `/`; oxc
  // reads a function there and keeps the glued `/`.
  ["slash-function", "a{b:a/f(c), d;c:x a/f(c d) y;d:a/f (c);e:a/f((c))}"],
  // A function's last `,` was kept and an empty first argument (`f(,a)`) was an ERROR; oxc drops the last `,` but in
  // `var()`, and spaces the first.
  [
    "argument-edge-commas",
    "a{b:f(a,);c:rgba(1,2,3,);d:f(a,/*c*/);e:var(--a,);f:VAR(--a,b,);g:var(--a,f(b,));h:f(,a);i:f(,);j:url(a,)}",
  ],
  // A `#name`, `#hex` or `$name` glued to a number stayed glued; oxc lexes it as a token of its own.
  ["number-hash", "a{b:1#b;c:1px#b, d;d:f(1#b);e:1#fff;f:1$b}"],
  // A word ending in `*` stayed glued, and `a/f(c)/g` was raw tokens with each `/` spaced; oxc spaces the `*` and
  // keeps a chain of glued `/` tight.
  ["star-end-slash-chain", "a{b:f(a*);c:a*;d:a* b;e:a/f(c)/g;f:x/f(c)/g(d)/h;g:a/f(c)*g}"],
  // A `!` before a word other than `important` was an ERROR, kept as written; oxfmt keeps it glued or one space apart
  // as written, and a lone `!word` entry breaks the list.
  ["bang-word", "a{b:a!c;c:a  !c d;d:a!c!important;e:!c,a;f:f(x)!c;g:a!importantx;h:a!c ! IMPORTANT}"],
  // A comment past a value's leading comma printed before it, as postcss's `between`; oxfmt reads it as the next
  // entry's, and an entry of comments alone breaks the list.
  ["comment-after-leading-comma", "a{b:,/*c*/a;c:, /*c*/ a,d;e:x,/*c*/,a;f:/*c*/,/*d*/a}"],
  // A comment before a `*` or `/` trailed the word before it; oxfmt breaks the line before the comment.
  [
    "comment-before-slash",
    `a{b:${"x".repeat(73)} /* q */ / c;c:${"x".repeat(73)} /* q */ * c;d:x /* q */ / c}`,
  ],
  // A value of `!important` alone took the space after the `:` and the one before `!important`: `b:  !important`.
  ["important-alone", "a{b:!important;c: ! IMPORTANT;d:/*c*/!important;e: /*c*/ !important}"],
  // A lone `!`, a `%` or a `.` delim in a value was an ERROR that kept the whole rule as written.
  ["delim-value", "a{b:.a!optional;c:a ! c;d:a! c;e:x % c;f:x /* q */ % c;g:a! c, d;h:% c}"],
  // A comment inside an `@include`/`@mixin` prelude was dropped instead of moved after the prelude.
  [
    "include-prelude-comment",
    "@include f(x /*q*/ / c, y /*r*/);\n@include x /*q*/ y;\n@include f(g(x /*q*/));\n@include f(x /*q*/ / c) {a:b}\n@mixin f(x /*q*/ / c) {}\n",
  ],
  ["word-hash-star","a{b:a#b, d;c:x a#b#c;d:f(a*c);e:a$c;f:url($a*3);g:calc(a*c);h:f(w-*);i:a #b}"],
  // The space before a `%` selector after a compound (`a:b %c`, `.a %c`) was glued as `a:b%c`.
  ["placeholder-gap", ".x{a:b %c{d:e}}\n.x{a %c{d:e}}\n.x{a:b%c{d:e}}\n.a %c{d:e}\n.x{a:b  %c{d:e}}"],
  // A nested rule whose selector tree-sitter wraps in an ERROR (`a:b !c`, `a:b c%`) kept the rule as written.
  [
    "selector-error-tail",
    ".x{a:b !c{d:e}}\n.x{a:b c%{d:e}f:g}\n.x{a:b>c   !d   {d:e}}\n.x{a:b /*q*/ 1.5% /*r*/ {}}\na:b c!{d:e}",
  ],
  // A commented @media prelude re-spaced and lowercased a feature `(A:B)` whose `:` has no space beside it.
  [
    "media-comment-raw-feature",
    "@media (A:B) /*q*/ {x{y:z}}\n@media (a :b)   and  (min-width:1.50px)/*q*/ {x{y:z}}\n@media ( a:b ) /*q*/,(c/*r*/:d) {x{y:z}}",
  ],
  // A commented @import/@supports prelude re-spaced its paren groups (`(a:b)` as `(a: b)`) and split `not(a:b)`.
  [
    "value-prelude-comment-raw",
    "@import url(a) (a:b) /*q*/;\n@import url('a') layer(x) supports(display:grid) ( a :b ) /*q*/;\n@supports (a :b) /*q*/ and not(c:'d') {x{y:z}}\n@supports selector(a>b)/*q*/{x{y:z}}",
  ],
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
const theirs = (text: string, options: Partial<CssOptions>) => oxfmt.format("x.css", text, options);

describe.each(optionSets)(
  "a CSS file lays out byte-identical to oxfmt 0.70.0 (%s), so the reviewer sees the layout their tools write",
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
  ["defaults", {}, "bootstrap.css", 1641, 1641],
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
    328,
    328,
  ],
  [
    "singleQuote, tabWidth 4, printWidth 100",
    optionSets[1]?.[1] ?? {},
    "bootstrap.css",
    1641,
    1641,
  ],
];

describe.skipIf(!present)(
  "the fetched CSS corpus keeps its count of chunks byte-identical to oxfmt, so a layout regression cannot hide in a large file",
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

// Input, options, then today's output, which differs from oxfmt's.
const divergences: [string, string, Partial<CssOptions>, string][] = [
  // tree-sitter-css knows only lowercase `from`; an uppercase one is an ERROR.
  [
    "uppercase-from",
    "@keyframes x{FROM{a:b}}",
    {},
    "@keyframes x{FROM{a:b}}\n",
  ],
  // The core ends every file with a newline; prettier prints an empty file as nothing.
  ["empty-file", "", {}, "\n"],
];

describe("a known gap from oxfmt stays pinned, so closing one shows up as a test change", () => {
  it.each(divergences)("%s", async (_, text, options, pinned) => {
    expect(ours(text, options)).toBe(pinned);
    expect(await theirs(text, options)).not.toBe(pinned);
  });
});
