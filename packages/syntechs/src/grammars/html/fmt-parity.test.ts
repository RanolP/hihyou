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
