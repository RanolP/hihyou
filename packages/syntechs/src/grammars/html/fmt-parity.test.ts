import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { oxfmt } from "../../fmt/conformance/references.node.js";
import { format } from "../../fmt/format.js";
import { type HtmlOptions, html } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with oxfmt 0.70.0 over prettier's defaults, or the options a case names, for an `.html` file.

const edgeCases: [string, string, Partial<HtmlOptions>?][] = [
  // A doctype refused the whole file, and an uppercase `<!DOCTYPE html>` must print as `<!doctype html>`.
  ["doctype-html5", "<!DOCTYPE html>\n<html><body><p>a</p></body></html>\n"],
  // A doctype with a public id keeps its marker as written and joins its value onto one line.
  [
    "doctype-public",
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"\n  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n<p>a</p>\n',
  ],
  // A text glued to the doctype borrows its `>`.
  ["doctype-glued-text", "<!DocType html>text\n"],
  // An unquoted or single-quoted attribute value and a void element closed `/>` failed `check`.
  ["requoted-attributes", "<p title=Title lang='en'>a<br></p>\n"],
  // A void element written without `/>` took the text after it as its child: `a<br>b` printed `a<br b/>`.
  ["void-then-text", "<div>a<img src=x>b <br> c<input>d</div>\n"],
  // A tag named after an Object.prototype member read it as its display or white-space and crashed.
  ["object-prototype-tags", "<constructor>a</constructor>\n<toString></toString>\n"],
  // A class value refused the file; its names print one space apart, on one line however long, always double-quoted.
  [
    "class-names",
    `<div class="  a b\n c ">x</div>\n<p class=" a&quot;b  c" title='t'>y</p>\n<i class="  {{ a }}  b">z</i>\n<b class="   ">w</b>\n<div id="x" class="${"cls-name ".repeat(12)}">x</div>\n`,
  ],
  // A script refused the file; its JS, TS or JSON prints through that formatter one level in, a blank one empty.
  [
    "script-content",
    '<div><script>let x=1;let y=2</script></div>\n<script type="module">import a from "a"\n\n\na()</script>\n<script type="importmap">{"imports":{"a":"b"}}</script>\n<script lang="ts">let a:number=1</script>\n<script>\n\n  </script>\n',
  ],
  // A style refused the file; its CSS prints through the css formatter one level in.
  ["style-content", '<html><head><style media="screen">a{b:c}\n\n\nd{e:f}</style></head></html>\n'],
  // An uppercase `CLASS` refused the file, and `<DIV ID>` kept its case where prettier lowercases a known name.
  [
    "known-names-lowercased",
    '<DIV ID="a" DATA-X="b" CLASS="a  b">x</DIV>\n<span ID="a">x</span>\n<foo CLASS="  a ">x</foo>\n<A HREF="x">y</A>\n',
  ],
  // An unknown script type or style lang refused the file; its content prints as written, dedented, one level in.
  [
    "unknown-script-style-verbatim",
    '<div><script type="text/template">a\n    <b>\n\n\n  </b>   </script></div>\n<style lang="stylus">\n\n\n  a\n     \n    b c\n</style>\n<script src="a.js">  let x=1  </script>\n',
  ],
  // A style attribute refused the file; it prints as css declarations, broken one per line with a last `;`.
  [
    "style-attribute",
    `<div style="color:red;background:blue">x</div>\n<div style='content:"x"'>y</div>\n<div style="  ">z</div>\n<div style="a b c">w</div>\n<div style="{{ a }}">v</div>\n<div style="color:#FFF;margin:0 auto;\n\npadding:.5px;font-family:Arial, Helvetica, sans-serif">u</div>\n`,
  ],
  // A leading `---` front matter joined into the text after it; yaml prints `key: value` with one space, a blank line after.
  ["front-matter-yaml", '---\nhello:     world\ntitle: "A"\n---\nTest <a\nhref=x>abc</a>.\n'],
  // A front matter in another language lost a whitespace-only line's spaces; it prints as written.
  ["front-matter-custom", "---mycustomparser\n  \ntitle: Hello\n\n---\n\n\n<h1>a</h1>\n"],
  // bracketSameLine was ignored: a broken opening tag's `>` or ` />` must stay on its last attribute's line.
  [
    "bracket-same-line",
    `<div long_attribute="${"v".repeat(70)}">text</div>\n<img long_attribute="${"v".repeat(70)}" src="a" />\n`,
    { bracketSameLine: true },
  ],
  // singleAttributePerLine was ignored: two or more attributes must break one per line.
  ["single-attribute-per-line", '<img src="a" alt="b" />\n<div data-a="1">x</div>\n', { singleAttributePerLine: true }],
  // htmlWhitespaceSensitivity was ignored: strict reads every node as inline, ignore as block.
  ...(["strict", "ignore"] as const).map((s): [string, string, Partial<HtmlOptions>] => [
    `whitespace-sensitivity-${s}`,
    "<div>a <span> b </span><p> c </p> <!-- x --> <b>d</b></div>\n<p>\n  text <a href='x'>link</a>\n</p>\n",
    { htmlWhitespaceSensitivity: s },
  ]),
  // An iframe's allow refused the file; its directives print `; `-separated, broken one per line with a last `;`.
  [
    "iframe-allow",
    `<iframe allow=" ;  ; "></iframe>\n<iframe allow="   camera\n'self';; usb"></iframe>\n<iframe allow="camera ${"https://a.example.com ".repeat(4)}; usb"></iframe>\n`,
  ],
  // An `on-click`, `onClick`, or an allow/srcset off its elements refused the file; prettier keeps them as written.
  ['unformatted-lookalike-attributes', '<div on-click="a( 1 )" onClick="b( 2 )" allow=" x ;y" srcset=" a  1x ">x</div>\n'],
  // A blank file printed one line break.
  ["blank-file", "  \n\n "],
  // A file that is one text with no trailing newline must still end in one.
  ["text-only-file", "a"],
  // A `<!-- display: x -->` comment refused the file; it sets the display of the node after it.
  ["display-comment", "<div>\n  <!-- display: inline -->\n  <p>Long Long Long Long Long Long Long Long Long Long Long Long Long Long</p>\n</div>\n"],
  // A `<!-- prettier-ignore -->` refused the file; the node after it prints as written, less the markers its neighbours borrow.
  [
    "prettier-ignore",
    "<div>\n<!-- prettier-ignore -->\n<p   a = 'b' >x   y</p>   \n<p>z</p></div>\n<span>a</span><!-- prettier-ignore --><b  >c</b><i>d</i>\n<p>text <!-- prettier-ignore --> <b> x  </b> tail</p>\n",
  ],
  // An img's srcset refused the file; its candidates print `, `-apart, broken with each descriptor aligned, an invalid one as written.
  [
    "srcset",
    '<img srcset="a.png 1x,b.png 2x">\n<img srcset="  a.png   100w ,  bbbbbbbbbbbbbbbbbbbbbb.png 2000w, ccccccccccccccccccccccccccccccc.png 300w, d.png 4w">\n<source srcset="a.png 1.5x, bb.png 2x, c">\n<img srcset="a 400w 100h, b 500w">\n<img srcset=",,,">\n',
  ],
  // A conditional comment kept its content as written; it prints as HTML, `<!--[if x]><!--><tag><!--<![endif]-->` as one tag, an unclosed one as written.
  [
    "conditional-comments",
    "<html><head><!--[if lt IE 9]>\n<script src='a.js'></script>\n<![endif]--></head></html>\n<div>\n<!--[if IE 5]>This is IE 5<br><![endif]-->\n</div>\n<!--[if lt IE 9]><p class=x><![endif]-->\n<!--[if gte IE 9]><!--><p><!--<![endif]-->a</p>\n<!--[if IE]>\n   <p>x</p>\n  <![endif]-->\n",
  ],
  // The check refused a requoted value whose `&apos;` printed as a bare `'`, which means the same character.
  // A closing tag broke off a last comment ending on its own line, `-->\n</ul>`, where oxfmt hugs it.
  ["comment-last-hugs-close", "<ul><!-- 1\n--><li>a</li><!--\n\n2\n--></ul>\n<span><!--\n--><span>a</span><!--\n--></span>\n"],
  // The check refused an implicitly closed `<p>`/`<li>` or an element the file's end closes, and the blank line after
  // one counted from its content's end rather than its start tag's.
  [
    "implicit-close",
    "<p>a\n<div>x</div>\n<p>\na\n<div>y</div>\n<ul><li>a\nb\n<li>c</ul>\n<!-- prettier-ignore -->\n<p>\n# Hi\n<div>",
  ],
  // An `on*` value refused the file; it prints as a single-quoted JS program, a lone expression without its `;`, a
  // directive double-quoted, one not parsing as written.
  [
    "event-handler",
    `<b onclick="alert(    '1')" onmouseover='f("a")'>x</b>\n<b onclick="a();   b()">y</b>\n<b onclick="\n  return false\n">z</b>\n<b onclick="'use strict'; f()" onblur="a b c" ONCLICK="f( 1 )">w</b>\n`,
  ],
  ["event-handler-no-semi", `<b onclick="[a].forEach(f); g()">x</b>\n`, { semi: false }],
  ["requoted-apos", `<div title="123 &apos;&quot; 456">x</div>\n<p title='a "b" &apos;c'>y</p>\n`],
];

function ours(text: string, options: Partial<HtmlOptions>) {
  const out = format(parseTree(language, text), html, options);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  const problem = check(html, text, out.text);
  if (problem) throw new Error(`check: ${problem}`);
  return out.text;
}
const theirs = (text: string, options: Partial<HtmlOptions>) => oxfmt.format("x.html", text, options);

describe("an HTML file lays out byte-identical to oxfmt 0.70.0, so the reviewer sees the layout their tools write", () => {
  it.each(edgeCases)("%s", async (_, text, options = {}) => {
    expect(ours(text, options)).toBe(await theirs(text, options));
  });
});
