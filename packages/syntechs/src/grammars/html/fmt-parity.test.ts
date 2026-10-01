import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { oxfmt } from "../../fmt/conformance/references.node.js";
import { format } from "../../fmt/format.js";
import type { PrettierOptions } from "../../fmt/options.js";
import { html } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with oxfmt 0.70.0 over prettier's defaults, for an `.html` file.

const edgeCases: [string, string][] = [
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
];

function ours(text: string, options: Partial<PrettierOptions>) {
  const out = format(parseTree(language, text), html, options);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  const problem = check(html, text, out.text);
  if (problem) throw new Error(`check: ${problem}`);
  return out.text;
}
const theirs = (text: string, options: Partial<PrettierOptions>) => oxfmt.format("x.html", text, options);

describe("an HTML file lays out byte-identical to oxfmt 0.70.0, so the reviewer sees the layout their tools write", () => {
  it.each(edgeCases)("%s", async (_, text) => {
    expect(ours(text, {})).toBe(await theirs(text, {}));
  });
});
