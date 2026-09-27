import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import type { DslGrammar } from "../../fmt/dsl/dsl.js";
import { referenceRules } from "../../fmt/dsl/reference.js";
import { format } from "../../fmt/format.js";
import type { Language } from "../../fmt/rules.js";
import { css, type CssOptions, customs } from "./fmt.js";
import * as gen from "./fmt.gen.js";
import * as spec from "./format.js";
import { grammar, language } from "./index.js";

const corpusDir = join(import.meta.dirname, "../../../corpus");
const fixtures = join(corpusDir, "prettier-3.9.9/tests/format/css");

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "__snapshots__" ? [] : files(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

const edgeCases = [
  "",
  ".a{}",
  "a { /* only */ }",
  "a { /* a */ /* b */ }",
  "a { // x\n}",
  "/* head */\na { color : red ; /* trail */\n  /* lead */\n  b: c }\n\n/* end */\n",
  "/* a */\n\n/* b */\n.c{}",
  "a{b:c;\n\n\nd:e}\n\n\n.f{g:h}",
  "a{color:red!important;margin:0 !important}",
  "a{b:c}",
  "a{transition:opacity .15s linear,transform .3s ease-out;font-family:a,b,c}",
  "a{font-family:-apple-system,system-ui,Segoe UI,Roboto,Helvetica Neue,Arial}",
  "a{box-shadow:0 0 0 1px rgba(0,0,0,.1),0 2px 4px rgba(0,0,0,.2)}",
  "a{--x:a b,c d;--y:  10px}",
  `a{font:italic small-caps bold condensed 16px/2 ${"word ".repeat(16)}serif}`,
  "a{a:.5em;b:1.50PX;c:10E3;d:+.5;e:0.0;f:1e-07}",
  "a{color:#ABCDEF;b:INHERIT;C:Red}",
  "a{width:calc(100% - (2*var(--a)));height:calc( 1px + 2px )}",
  "a{transform:translate(-50%,-50%) rotate(45deg);color:rgba(var(--rgb),.75)}",
  'a{background:url( "a b" ),url(b.png)}',
  'a{grid-template-areas:"a b"\n  "c d";grid-template-columns:[full-start] 1fr\n  [full-end]}',
  `a{content:"it's";b:'say "hi"';c:'both \\' and "';d:'x'}`,
  "a>b~c+d e,.f:hover::before,#g[type=text],[class*='col-'],*,svg|a{x:y}",
  `${Array.from({ length: 8 }, (_, i) => `.selector-number-${i}`).join(",")}{x:y}`,
  ".very-long-selector-name-number-one .very-long-selector-name-number-two > .very-long-selector-name-number-three{x:y}",
  "li:nth-child( 2n+1 ),li:NTH-CHILD(even),.y:is(.a,.b) .z:where(.c),a:not(:first-child){x:y}",
  "@media screen and (-webkit-min-device-pixel-ratio:2),(min-resolution:192dpi){a{b:c}}",
  "@media (min-width:768px) and (max-width:991.98px){a{b:c}}",
  "@supports not (display:grid){a{b:c}}",
  "@supports (a:b) /* c */ {}",
  "@-webkit-keyframes x{from{a:b}50%{c:d}to{e:f}}@keyframes y{0%,to{a:b}}",
  "@keyframes /* c */ x{}",
  "@keyframes x{from{}\n\n/* c */\nto{a:b}}",
  "@charset 'utf-8';@import 'a.css';@import url(a.css) screen , print;",
  '@font-face{font-family:x;src:url(a.woff2) format("woff2"),url(a.woff) format("woff")}',
  "@layer a,b;@container (min-width:400px){a{b:c}}",
  "@counter-style /* c */ thumbs {}",
  "a /* x */ , b /* y */ {c:d}",
  "a{b /* k */ : /* v */ c}",
  "a{filter:progid:DXImageTransform.Microsoft.gradient(startColorstr='#80000000')}",
  "a{\r\n  b:c;\r\n  /* x\r\n  y */\r\n\r\n\r\n  d:e\r\n}\r\n",
  "@page :first{margin:1in}",
  "@MEDIA (min-width:1px){a{b:c}}",
];

const corpus = [
  ...["normalize.css", "animate.css", "bootstrap.css"]
    .map((f) => join(corpusDir, f))
    .filter(existsSync)
    .map((f) => readFileSync(f, "utf8")),
  ...files(fixtures).map((f) => readFileSync(f, "utf8")),
  ...edgeCases,
];

const options: Partial<CssOptions>[] = [
  {},
  { singleQuote: true, tabWidth: 4, printWidth: 100 },
  { printWidth: 40 },
];

const run = (text: string, lang: Language<CssOptions>, o: Partial<CssOptions>) =>
  format(parseTree(language, text), lang, o);

const generated = { ...css, stream: gen.css(customs) };
const reference = {
  ...css,
  stream: referenceRules<CssOptions>(spec.css, grammar as DslGrammar, customs),
};

// The generated rules fuse the two passes; a divergence from the reference would change a layout the spec
// says nothing about, in a way no reader of the spec could predict.
describe("the generated CSS formatter prints what the two-pass reference prints, output and anchors, so fusing the passes never changes a layout", () => {
  it("over the corpus, prettier's fixtures and edge cases", () => {
    for (const text of corpus)
      for (const o of options)
        expect(run(text, generated, o), text).toEqual(run(text, reference, o));
  });
});

// Moving CSS onto the DSL is a refactor: any change here is a layout the hand-written Doc rules never printed.
describe("the generated CSS formatter prints what the hand-written Doc rules print, output and anchors", () => {
  it("over the corpus, prettier's fixtures and edge cases", () => {
    for (const text of corpus)
      for (const o of options)
        expect(run(text, generated, o), text).toEqual(run(text, css, o));
  });
});
