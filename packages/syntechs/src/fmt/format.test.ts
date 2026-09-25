import { describe, expect, it } from "vitest";
import { parse } from "../core/index.js";
import { language as jsonParser } from "../grammars/json/index.js";
import { text, token } from "./doc.js";
import { format } from "./format.js";
import { defineLanguage, type Helpers } from "./rules.js";

const grammar = {
  kinds: ["document", "object", "pair", "array", "string", "number", "comment"],
  tokens: ["{", "}", "[", "]", ",", ":"],
  // `body` is not tree-sitter-json's: it gives the typecheck test a field that exists on a kind other than `pair`.
  fields: { pair: ["key", "value"], document: ["body"] },
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
const plain = defineLanguage(
  grammar,
  { lineComments: { comment: "//" } },
  rules,
);

async function run(text: string, language = plain) {
  const root = parse(jsonParser, text).nodes[0];
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
    const dropsColon = defineLanguage(
      grammar,
      { lineComments: { comment: "//" } },
      (h) => ({
        ...rules(h),
        pair: h.seq(h.field("key"), h.space, h.field("value")),
      }),
    );
    const text = '{"a":1}';
    expect(await run(text, dropsColon)).toMatchObject({
      ok: false,
      reason: "token-mismatch",
      text,
    });
  });

  it("a rule that prints a token twice returns the input unformatted, instead of a layout that invents code", async () => {
    const repeats = defineLanguage(
      grammar,
      { lineComments: { comment: "//" } },
      (h) => ({
        ...rules(h),
        number: (node, ctx) => [
          token(node, ctx.source.slice(node.start, node.end)),
          token(node, ctx.source.slice(node.start, node.end)),
        ],
      }),
    );
    expect(await run("[1]", repeats)).toMatchObject({
      ok: false,
      reason: "token-mismatch",
    });
  });

  it("a rule that swaps two fields returns the input unformatted, instead of a layout that shows code that does not exist", async () => {
    const swaps = defineLanguage(
      grammar,
      { lineComments: { comment: "//" } },
      (h) => ({
        ...rules(h),
        pair: h.seq(h.field("value"), ":", h.space, h.field("key")),
      }),
    );
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
    defineLanguage(grammar, { lineComments: { comment: "//" } }, (h) => ({
      ...rules(h),
      // @ts-expect-error: `objekt` is not a kind of this grammar
      objekt: h.verbatim(),
    }));
  });

  it("a seq reading a field its kind lacks fails typecheck, instead of printing nothing for it at run time", () => {
    defineLanguage(grammar, { lineComments: { comment: "//" } }, (h) => ({
      ...rules(h),
      // @ts-expect-error: `body` is a field of `document`, not of `pair`
      pair: h.seq(h.field("body")),
    }));
  });

  it("a seq reaches children in no field by kind or by position, so such a child is printed rather than dropped", async () => {
    const byKind = defineLanguage(
      grammar,
      { lineComments: { comment: "//" } },
      (h) => ({ ...rules(h), document: h.seq({ kind: "object" }) }),
    );
    const byPosition = defineLanguage(
      grammar,
      { lineComments: { comment: "//" } },
      (h) => ({ ...rules(h), document: h.seq({ nth: 0 }) }),
    );
    for (const language of [byKind, byPosition])
      expect(await run('{"a" :1}', language)).toMatchObject({
        ok: true,
        text: '{ "a": 1 }\n',
      });
  });

  it("args a rule passes to `print` reach the child's rule, so a parent can steer how a child prints", async () => {
    const marks = defineLanguage(
      grammar,
      { lineComments: { comment: "//" } },
      (h) => ({
        ...rules(h),
        document: (node, ctx) =>
          ctx.items(node).map((n) => ctx.print(n, { mark: "!" })),
        number: (node, ctx, args) => [
          token(node, ctx.source.slice(node.start, node.end)),
          text(String(args?.["mark"] ?? "")),
        ],
      }),
    );
    expect(await run("1", marks)).toMatchObject({ ok: true, text: "1!\n" });
  });
});
