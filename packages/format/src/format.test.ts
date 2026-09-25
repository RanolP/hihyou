import { createSyntaxParser } from "@hihyou/engine";
import { nodeGrammarLocator } from "@hihyou/engine/node";
import { describe, expect, it } from "vitest";
import { token } from "./doc.js";
import { format } from "./format.js";
import { defineLanguage, type Helpers } from "./rules.js";

const parser = createSyntaxParser({ locateGrammar: nodeGrammarLocator });
const grammar = {
  kinds: ["document", "object", "pair", "array", "string", "number", "comment"],
  tokens: ["{", "}", "[", "]", ",", ":"],
  fields: ["key", "value"],
  comments: ["comment"],
} as const;

const rules = (h: Helpers<typeof grammar>) => ({
  document: h.block(),
  object: h.list({
    open: "{",
    close: "}",
    sep: ",",
    pad: true,
    blankLines: "force",
  }),
  array: h.list({ open: "[", close: "]", sep: ",", blankLines: "ifBroken" }),
  pair: h.seq(h.field("key"), ":", h.space, h.field("value")),
});
const plain = defineLanguage(grammar, { lineComment: "//" }, rules);

async function run(text: string, language = plain) {
  const tree = await parser.parse("json", text);
  const root = tree.nodes[0];
  if (!root) throw new Error("empty tree");
  return format(root, text, language);
}

describe("format", () => {
  it("a list that breaks puts each item on its own indented line, instead of overflowing the width", async () => {
    const long = `[${Array.from({ length: 30 }, (_, i) => `"item${i}"`).join(",")}]`;
    const out = await run(long);
    expect(out.ok && out.text.split("\n")[1]).toBe('  "item0",');
  });

  it("every anchor points from a token's input range to the same text in the output, so a reviewer's cursor maps across", async () => {
    const text = '{"a":[1,2],  "b" : "x"} // end\n';
    const out = await run(text);
    if (!out.ok) throw new Error(out.detail);
    expect(out.text).toBe('{ "a": [1, 2], "b": "x" } // end\n');
    for (const { from, to } of out.anchors)
      expect(out.text.slice(...to)).toBe(text.slice(...from).trimEnd());
    expect(out.anchors).toHaveLength(14);
  });

  it("a rule that drops a token returns the input unformatted, instead of a layout that hides code", async () => {
    const dropsColon = defineLanguage(grammar, { lineComment: "//" }, (h) => ({
      ...rules(h),
      pair: h.seq(h.field("key"), h.space, h.field("value")),
    }));
    const text = '{"a":1}';
    expect(await run(text, dropsColon)).toMatchObject({
      ok: false,
      reason: "token-mismatch",
      text,
    });
  });

  it("a rule that prints a token twice returns the input unformatted, instead of a layout that invents code", async () => {
    const repeats = defineLanguage(grammar, { lineComment: "//" }, (h) => ({
      ...rules(h),
      number: (node, ctx) => [
        token(node, ctx.source.slice(node.start, node.end)),
        token(node, ctx.source.slice(node.start, node.end)),
      ],
    }));
    expect(await run("[1]", repeats)).toMatchObject({
      ok: false,
      reason: "token-mismatch",
    });
  });

  it("a rule that swaps two fields returns the input unformatted, instead of a layout that shows code that does not exist", async () => {
    const swaps = defineLanguage(grammar, { lineComment: "//" }, (h) => ({
      ...rules(h),
      pair: h.seq(h.field("value"), ":", h.space, h.field("key")),
    }));
    const text = '{"a":1}';
    expect(await run(text, swaps)).toMatchObject({
      ok: false,
      reason: "token-mismatch",
      text,
    });
  });

  it("an unparsable region is kept verbatim rather than rejected, so the rest of the file still formats", async () => {
    const out = await run('[{"a":1,,  "b":2},   3]');
    expect(out).toMatchObject({ ok: true, text: '[{"a":1,,  "b":2}, 3]\n' });
  });

  it("a value the parser invented is not printed as an item, so `[1,2,]` never shows as `[1, 2, ]`", async () => {
    expect(await run("[1,2,]")).toMatchObject({ ok: true, text: "[1,2,]\n" });
    expect(await run('{"a":1')).toMatchObject({ ok: true, text: '{"a":1\n' });
  });

  it("a comment inside an empty list survives, instead of vanishing with the list's items", async () => {
    const out = await run("[ // none\n]");
    expect(out).toMatchObject({ ok: true, text: "[\n  // none\n]\n" });
  });

  it("a rule table naming a kind the grammar lacks fails typecheck", () => {
    defineLanguage(grammar, { lineComment: "//" }, (h) => ({
      ...rules(h),
      // @ts-expect-error: `objekt` is not a kind of this grammar
      objekt: h.verbatim(),
    }));
  });
});
