import { expect, test } from "vitest";
import type { GrammarName } from "./corpus.node.js";
import { language as css } from "./generated/css.js";
import { language as javascript } from "./generated/javascript.js";
import { language as json } from "./generated/json.js";
import type { Language } from "./language.js";
import { checkParity } from "./parity.node.js";

// Small inputs that exercise the lexer, the tables and error recovery (MISSING insertion, ERROR wrapping).
// The fetched corpus runs through `node dist/parity.node.js`; this keeps a regression visible in `pnpm test`.
// Generated modules are imported statically: vitest cannot resolve a template dynamic import to a .ts file.
const CASES: Partial<Record<GrammarName, [Language, string[]]>> = {
  json: [
    json,
    [
      '// c\n{"aé\n": [1, -2.5e3, true, false, null, "\u{1F600}x", {}, []], /* block */ "b": {"c": ""}}\n',
      '{"a": [1, 2,, 3], "b" 4}',
      '{"a": {"b": [1, 2}',
      '[1, 2 3, "x\\q", @, ]',
      "",
    ],
  ],
  css: [
    css,
    [
      "a b > c:hover::before, #x .y[z='1'] { color: red !important; margin: 0 auto; }\n@media (min-width: 10px) { a:not(.b) { top: calc(1px + 2%); } }\n",
      "a { color: red; b:hover { x: 1 } }\n/* c */ @import url(x.css);",
      "a { color: ; } b { : red } c:",
      "a:hover /* { */ { x: y }",
    ],
  ],
  javascript: [
    javascript,
    [
      // Automatic semicolons, template chars, regex vs division, ternary `?` vs `?.`, JSX text, HTML comments.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source under test, not a template.
      "let a = b\n++c\nconst t = `x${a}y\\n`\nconst r = a / 2 / 3, s = /re[/]g/.test(t)\nx = a ? .5 : b?.c\n<!-- old\nconst j = <div>\n  hi {a} &amp; <b/>\n</div>\nif (a) b\nelse c\nfor (const k in o) {}\n",
      "function f( { return 1 }\nclass { #x = 1; static { y() } }\nconst o = { a: 1,, b }",
      "a\ninstanceof B\na\nin b\n/* c\n */ d",
    ],
  ],
};

for (const [grammar, [lang, texts]] of Object.entries(CASES) as [
  GrammarName,
  [Language, string[]],
][]) {
  test(`the ${grammar} tree matches web-tree-sitter node for node, broken inputs included`, async () => {
    const r = await checkParity(
      grammar,
      texts.map((text, i) => ({ name: `case${i}`, text })),
      lang,
    );
    expect(
      r.divergences.map(
        (d) =>
          `${d.input.name} at ${d.index}: ${d.expected[d.index]} vs ${d.actual[d.index]}`,
      ),
    ).toEqual([]);
  });
}
