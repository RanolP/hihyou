import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { oxfmt } from "../../fmt/conformance/references.node.js";
import { format } from "../../fmt/format.js";
import type { PrettierOptions } from "../../fmt/options.js";
import { yaml } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with oxfmt 0.70.0 over prettier's defaults, and under the tabWidth and singleQuote prettier's yaml
// fixtures set. What print.ts has no rule for (comments in flow collections, multi-line flow scalars, explicit keys) refuses,
// as `refused` below pins.

type Options = Partial<PrettierOptions> & { singleQuote?: boolean };

const optionSets: [string, Options][] = [
  ["defaults", {}],
  ["tabWidth 4, singleQuote", { tabWidth: 4, singleQuote: true }],
  // Flow mappings drop their inner spaces: `{a: 1}`.
  ["bracketSpacing false", { bracketSpacing: false }],
];

const edgeCases: [string, string][] = [
  // `key:   value` kept its run of spaces instead of collapsing it to one.
  ["pair-spacing", "a:   1\nb:    two\n"],
  // A nested mapping kept its source indent instead of tabWidth.
  ["nested-indent", "a:\n    b: 1\n    c:\n          d: 2\n"],
  // A sequence under a key stayed at the key's column instead of moving in by tabWidth.
  ["sequence-under-key", "a:\n- x\n-   y\nb:\n    - z\n"],
  // A mapping inside a sequence item lost its alignment two columns past the dash.
  ["sequence-of-mappings", "- a: 1\n  b: 2\n-   c: 3\n    d: 4\n- - x\n  - y\n"],
  // A trailing comment kept its run of spaces, or a tab, instead of one space.
  ["trailing-comment", "a: 1    # t\nb: 2\t# u\nc: # on the key\n  d: 1\n"],
  // An own-line comment kept its source column instead of its collection's indent, or one level past a scalar item.
  [
    "own-line-comments",
    "a:\n    b: 1\n# c0\n    c: 2\n      # deeper\n    d: 3\n    # end\ne: 4\n # past e\nf: 5\n",
  ],
  // Blank lines were kept as a run, or kept at a collection's start.
  ["blank-lines", "a:\n\n  b: 1\n\n\n\n  c: 2\n\n# c\n\nd: 3\n"],
  // Document markers and directives were dropped or moved.
  ["documents", "%YAML 1.2\n---\na: 1\n...\n---\n# b\nb: 2\n"],
  // A quoted scalar kept its quote where prettier swaps it, or swapped one an escape pins.
  ["quotes", "a: 'x'\nb: 'it''s'\nc: 'say \"hi\"'\nd: 'back\\slash'\ne: \"a'b\\\"c\"\nf: \"\\n\"\n"],
  // An anchor, tag or alias kept its run of spaces, or a collection's properties left the key's line.
  ["properties", "a: &x   1\nb:   *x\nc: !t   &y 'q'\nd: &m\n  e: 1\ng:\n  - &s\n    f: 1\n"],
  // An alias key lost the space before its colon, which then reads as part of the alias name.
  ["alias-key", "*a : 1\n&k key: 2\n"],
  // A value collection's comment after its properties stayed on its own line; oxfmt trails it.
  ["comment-after-properties", "key1: &default\n\n  # note\n  sub: 1\n"],
  // A blank file printed a line break instead of nothing.
  ["blank", "\n\n"],
  // A block scalar's content kept its source indent instead of moving to its collection's indent plus tabWidth.
  ["block-scalar-reindent", "a: |\n      x\n       y\n\n      z\nb:\n- >-\n      w\n"],
  // Chomping lost its trailing blank lines: clip and strip keep one before a sibling, keep keeps them all.
  ["block-scalar-chomping", "a: |\n  x\n\n\nb: |+\n  y\n\n\nc: >-\n  z\n\n"],
  // An indentation indicator's content moved with the collection instead of staying at the indicator's column.
  ["block-scalar-explicit-indent", "a: |2\n      x\nb: |+1\n   y\n"],
  // Trailing spaces inside a block scalar's content, or its whitespace-only line, were trimmed.
  ["block-scalar-whitespace", "a: >\n  aa \n    \n  bb\nb: |\n  x\n   \nc: 1\n"],
  // The blank line after a block scalar was doubled, or dropped before a comment, since the next token's lf counts its content.
  ["block-scalar-blank-after", "- |\n  x\n- 1\n- |\n  y\n\n# c\n"],
  // An empty sequence item lost the space its absent value takes before a trailing comment.
  ["empty-item-comment", "- # c\n- x\n"],
  // A flow collection kept its source spacing and trailing comma instead of `{ a: 1 }` / `[a, b]`.
  ["flow-flat", "a: {b: 1,c: [x,y,],  d: {}}\nb: [ ]\nc: {e, f: }\nd:\n  - [&x 1, *x, g: h]\n"],
  // A flow collection past printWidth stayed on one line instead of moving under its key and breaking per item.
  ["flow-broken-under-key", `a: [${Array.from({ length: 13 }, (_, i) => `item${i}`).join(", ")}]\n`],
  // A broken flow under a sequence item moved to the next line, or lost the dash's two-column alignment.
  ["flow-broken-in-sequence", `- {${Array.from({ length: 8 }, (_, i) => `k${i}: value${i}`).join(", ")}}\n`],
  // A flow value that fits once moved below its key still broke, or a pair value inside a broken flow stayed put.
  ["flow-moved-flat", `${"k".repeat(70)}: [a, b, c, d]\nz: {b: [${Array.from({ length: 13 }, (_, i) => `item${i}`).join(", ")}]}\n`],
  // A blank line between broken flow items was dropped, doubled, or kept in a flat one.
  ["flow-blank-lines", `a: [1,\n\n  2]\nb: [${Array.from({ length: 4 }, (_, i) => `item${i}`).join(",\n\n\n  ")}, ${Array.from({ length: 10 }, (_, i) => `o${i}`).join(", ")}]\n`],
  // A root flow collection with properties broke onto a new line after them, or broke at all when it fits.
  ["flow-root", `&x [${Array.from({ length: 13 }, (_, i) => `item${i}`).join(", ")}]\n---\n{a: 1}\n`],
];

// A folded scalar's refill under proseWrap always: lines join into paragraphs and refill at printWidth, except
// more-indented lines and blank-separated paragraphs; a literal scalar stays as written.
const proseCases: [string, string][] = [
  [
    "folded-refill",
    `a: >\n  aa bb\n  cc\n   dd\n\n  ${"word ".repeat(20)}\nb: |\n  ${"word ".repeat(20).trim()}\n`,
  ],
];

describe("a folded block scalar refolds as oxfmt 0.70.0 does under proseWrap always", () => {
  it.each(proseCases)("%s", async (_, text) => {
    const options = { proseWrap: "always" } as Options;
    expect(ours(text, options)).toBe(await theirs(text, options));
  });
});

function ours(text: string, options: Options) {
  const tree = parseTree(language, text);
  const out = format(tree, yaml, options);
  if (!out.ok) throw new Error(`${out.reason}: ${out.detail}`);
  const problem = check(yaml, text, out.text);
  if (problem) throw new Error(`check: ${problem}`);
  return out.text;
}
const theirs = (text: string, options: Options) => oxfmt.format("x.yaml", text, options);

describe.each(optionSets)(
  "a YAML file lays out byte-identical to oxfmt 0.70.0 (%s), so the reviewer sees the layout their tools write",
  (_, options) => {
    it.each(edgeCases)("%s", async (_, text) => {
      expect(ours(text, options)).toBe(await theirs(text, options));
    });
  },
);

const refused: [string, string][] = [
  // A comment inside a flow collection, which oxfmt lays out in ways print.ts has no rule for, printed anyway.
  ["flow-comment", "a: [1, # one\n  2]\n"],
  // A flow key past printWidth printed flat, where oxfmt makes it explicit (`? [`).
  ["flow-key-long", `[${"x".repeat(90)}]: c\n`],
  // A comment after a kept block scalar ending the stream printed a final line break, which oxfmt leaves off.
  ["kept-block-scalar-then-comment", "a: |+\n  x\n# c\n"],
  // `{? 1,? 2}` parses to an ERROR root spanning `{? 1` only, so printing its text dropped the rest.
  ["error-root", "{? 1,? 2,? 3}\n"],
  // A prettier-ignore comment's node was laid out instead of kept as written.
  ["prettier-ignore", "# prettier-ignore\na:    1\n"],
];

describe("a YAML construct print.ts has no rule for refuses rather than printing what oxfmt would not", () => {
  it.each(refused)("%s", (_, text) => {
    expect(format(parseTree(language, text), yaml, {}).ok).toBe(false);
  });
});
