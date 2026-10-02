import { describe, expect, it } from "vitest";
import { parseTree } from "../../core/index.js";
import { check } from "../../fmt/check.js";
import { oxfmt } from "../../fmt/conformance/references.node.js";
import { format } from "../../fmt/format.js";
import type { PrettierOptions } from "../../fmt/options.js";
import { yaml } from "./fmt.js";
import { language } from "./index.js";

// Byte parity with oxfmt 0.70.0 over prettier's defaults, and under the tabWidth and singleQuote prettier's yaml
// fixtures set. What print.ts has no rule for (some comments in flow pairs, multi-line scalars in flow collections)
// refuses, as `refused` below pins.

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
  // Content on the `---` line stayed there or refused, where oxfmt moves it to a line of its own.
  ["marker-line-content", "--- a\n--- 'b'\n--- !t\nc: 1\n--- &x\n- 1\n"],
  // A block scalar or flow collection on the `---` line kept its place, or lost its properties' line.
  ["marker-line-collections", "--- |\n  x\n--- [a, b]\n--- !t d\n"],
  // A root flow collection with properties broke onto a new line after them, or broke at all when it fits.
  ["flow-root",`&x [${Array.from({ length: 13 }, (_, i) => `item${i}`).join(", ")}]\n---\n{a: 1}\n`],
  // An explicit key kept its `?`, or a key with no value printed `key:` where oxfmt keeps `? key` (a flow key, a comment).
  ["explicit-keys", "? a\n: b\n? c\n? [d]\n? e # c\n? |\n  f\n: - g\n? - h\n: {i: j}\n"],
  // A comment between an explicit key and its `:` lost its line, or an empty key or empty pair dropped its colon.
  ["explicit-comments-empty", "? a\n# c\n\n: b\nd: 1\n: c\ne:\n  - ? x\n    :\n"],
  // A flow key past printWidth printed flat instead of `? [`, or its scalar value stayed beside it past printWidth.
  ["flow-key-long", `[${"x".repeat(90)}]: c\n[${"y".repeat(40)}]: ${"z".repeat(40)}\n`],
  // A flow pair's `?` or empty `: ` pair kept source spacing, or a wide flow key in a flow broke without `? `.
  ["flow-explicit-empty", `- {? a : x, b: c, : }\n- [? d : e, : ]\n- {[${"w".repeat(80)}]: [b]}\n`],
  // A flow `? key` with no `:` did not parse, or kept its `?` in a mapping, or lost it in a sequence, or a wide flow key alone broke without its `? ` in a sequence.
  ["flow-explicit-no-value", `- {? a,? [b]}\n- [? 1,? *c, d: e]\n- [? [${"l".repeat(40)}, ${"l".repeat(40)}]]\n- {? [${"m".repeat(40)}, ${"m".repeat(40)}]}\n`],
  // An indented comment outside every collection refused, where oxfmt prints it at column 0.
  ["indented-loose-comments", "  # a\n\n   # b\nk: 1\n---\n  # c\nx\n"],
  // A directive kept its run of spaces, or a blank line after it, or a comment after `...` moved before it.
  ["directives-and-end-marker", "%TAG  !e!   tag:e.com,2000:\n\n%FOO  bar   baz # c\n              # d\n\n---\na: 1\n...\n  # e\n---\nb\n"],
  // A comment before a scalar value refused, or lost its place on the key's line or the blank line before the value.
  ["scalar-value-comments", "a:    # c\n  # d\n  v\nb:\n\n  # e\n\n  'w'\nc: # f\n  x\n  y\nd:\n  - # g\n    z\n"],
  // A comment past a sequence item's scalar printed one tabWidth past the dash instead of at the scalar's column.
  ["sequence-item-past-comment", "a:\n  - 1\n    # c\n  - 2\n"],
  // A comment indented past an explicit key's `?` printed at the `?` column instead of two columns in.
  ["explicit-key-indented-comment", "? b\n    # c\n# d\n: v\nx:\n  ? e\n    # f\n  : w\n"],
  // Properties with no content refused, or lost the space oxfmt keeps after them in a flow or before a key's colon.
  ["properties-without-content", "- !!str\n- &a : x\n  b: !!null\n- {foo: !!str, !!str : bar, c: &x}\n- [!!str, a, !!int]\n"],
  // A multi-line plain or quoted scalar refused, or lost its blank-line paragraphs or the indent of its later lines.
  ["multiline-flow-scalars", `a: aaa\n  bbb\n\n  ccc\nb: "x\n  y"\nc: '${"w ".repeat(20)}\n  z'\n? m\n  n\n: v\nd:\n  - p\n    q\n`],
  // A multi-line value moved below its key whenever its first paragraph did not fit, where only its first word must.
  ["multiline-moved", `${"k".repeat(70)}: ${"v".repeat(20)} t\n  u\n${"k".repeat(70)}: ${"v".repeat(20)}\n  u\n\n  w\n`],
  // A block scalar after a quoted scalar or a directive refused: their text is more than their leaves.
  ["block-scalar-after-quoted", "%YAML 1.2\n---\na: 'x'\nb: \"y\\tz\"\nc: |\n    t\n\n\nd: 1\n"],
  // A comment inside a flow collection refused, or left it flat, or kept its place before a comma or after `[`.
  ["flow-comments", "a: [1, # one\n  2 # two\n  , 3\n\n  # own\n  ]\nb:\n  - {c: 1, # k\n    d: 2}\n---\n[ # open\n  x, [y, # z\n  w]]\n"],
  // A comment between a flow pair's key and value stayed before the colon, or an explicit pair lost its `?`.
  ["flow-pair-comments", "- {b # k\n  : 1, c:\n  # own\n  2}\n- [? d\n  # e\n  : 3]\n"],
  // Comments after properties refused, or more than one stayed beside them instead of each on its own line.
  ["props-comments", "!!map\n# c1\na: !!map # c2\n  # c3\n  b: 1\nc: !!seq # c4\n  [1]\n---\n!!set # c5\n# c6\n[]\n"],
  // Comments after a root scalar's properties refused, where oxfmt prints them as after a collection's.
  ["root-scalar-props-comments", "!!str #c\n>\n  123\n---\n!!str # c1\n\n# c2\nhello\n--- !!str\n# c3\n|\n  x\n"],
  // A value scalar's comments after its properties were refused instead of ending the key's line.
  ["value-scalar-props-comments", "k: !!str # c1\n  # c2\n  x y\nz: &a\n  # c\n  'q'\n"],
  // A block item after `# prettier-ignore` was laid out, or the ignore at the stream's first line was missed.
  ["prettier-ignore", "# prettier-ignore\nk:\n    x:   1\n    y:  [1,2]\nz:   1\n"],
  // A prettier-ignore inside an ignored item, or before a nested item or a sequence item, was not honored.
  ["prettier-ignore-nested", "a:\n  # prettier-ignore\n  b:   [1,   2]\n  c:   3\nd:\n  # prettier-ignore\n  - [1,  2]\n  - [3,  4]\n"],
  // A comment trailing an explicit pair's `:` refused, where oxfmt prints the key implicit and the comment below it.
  ["explicit-colon-comment", "? k\n: # c\n  # d\n  foo: bar\nx:\n  ? m\n  : # e\n    [a]\n? n\n: # f\n  v\n"],
  // A comment before an explicit block key or after its pair's `:` refused, where oxfmt trails the marker with it.
  ["explicit-block-key-comments", "? # c\n - a\n: # d\n - #e\n  b\n?\n  # f\n  g: 1\n"],
  // A multi-line scalar in a flow collection, or as a flow pair's key, refused instead of breaking the collection.
  ["multiline-flow-items", "- [\"a\n  b\", c\n\n  d, [e\n  f], ? g\n  h : i]\n- {j\n  k: l, m\n  n}\n---\n{ matches\n% : 20 }\n"],
  // A prettier-ignore before `---` or a flow item refused, where oxfmt keeps that document's content or item as written.
  ["prettier-ignore-document-and-flow", "a:   1\n# prettier-ignore\n---\nb:    [1,2]\n...\n---\n[\n  # prettier-ignore\n  [ b,\n      c ],\n  {  d:  1 }\n]\n"],
  // A comment shallower than a nested block's items but deeper than its parent's refused, or went past a block scalar.
  ["comment-after-nested-block", "a:\n  b:\n    c: 1\n   # x\n # y\nd:\n  - e\n # f\ng: |-\n  t\n # h\ni: 1\n"],
  // A comment right below another printed deeper than it, as its source column says, where oxfmt keeps it no deeper.
  ["comment-no-deeper-than-above", "x:\n  a: 1\n  # x\n    # y\n  b: 2\n"],
  // A `...` or comment after a kept block scalar ending the stream refused or printed a final line break oxfmt leaves off.
  ["kept-block-scalar-then-end", "a: |+\n  x\n# c\n---\n|+\n ab\n\n...\n"],
];

// A folded or plain scalar's refill under proseWrap always: lines join into paragraphs and refill at printWidth,
// except a folded scalar's more-indented lines and blank-separated paragraphs; a literal scalar stays as written.
const proseCases: [string, string][] = [
  // A plain scalar's words did not refill at printWidth, or a word too long to break was refused as past printWidth.
  ["plain-fill", `a: ${"word ".repeat(30)}\n  end\n\n  next\nb: ${"z".repeat(90)}\n`],
  [
    "folded-refill",
    `a: >\n  aa bb\n  cc\n   dd\n\n  ${"word ".repeat(20)}\nb: |\n  ${"word ".repeat(20).trim()}\n`,
  ],
];

describe("a folded or plain scalar refills as oxfmt 0.70.0 does under proseWrap always", () => {
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
  // A comment inside a flow pair's collection value, which oxfmt keeps on the key's line or drops the key of, printed anyway.
  ["flow-pair-value-comment", "a: {b: [1, # one\n  2], c: 3}\n"],
  // A blank line after a trailing comment in a flow collection, which oxfmt moves to column 0, printed anyway.
  ["flow-comment-blank-after", "a: [1, # one\n\n  2]\n"],
  // A block scalar ending the stream dropped its trailing whitespace line deeper than its content, which oxfmt keeps.
  ["block-scalar-deep-whitespace-end", "a: |-\n  ab\n   \n"],
  // A stream that parses to an ERROR root (an unclosed flow collection) printed the text it spans, dropping the rest.
  ["error-root", "a: [b, c\nd: 1\n"],
  // A prettier-ignore trailing a line, or before a document, was applied to the next block item.
  ["prettier-ignore-trailing", "a: 1 # prettier-ignore\nb:    2\n"],
  ["prettier-ignore-document", "--- # prettier-ignore\na:    1\n"],
  // Several comments before a sequence item's scalar, which oxfmt prints after `- ` with a trailing space, printed anyway.
  ["sequence-item-comments", "- # c\n  # d\n  v\n"],
  // A comment past a sequence item's block scalar, which oxfmt prints into the scalar's content, printed anyway.
  ["comment-past-sequence-block-scalar", "- |\n  t\n # c\n- y\n"],
  // A multi-line value in a flow pair, which oxfmt keeps in an unbroken collection, printed anyway.
  ["multiline-flow-pair-value", "{a: b\n c}\n"],
  // A blank line between a directive and a comment, which oxfmt drops, was kept.
  ["directive-blank-comment", "%YAML 1.2\n\n# c\n---\nb\n"],
];

describe("a YAML construct print.ts has no rule for refuses rather than printing what oxfmt would not", () => {
  it.each(refused)("%s", (_, text) => {
    expect(format(parseTree(language, text), yaml, {}).ok).toBe(false);
  });
});
