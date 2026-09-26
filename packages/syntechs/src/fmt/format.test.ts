import { describe, expect, it } from "vitest";
import { parseTree } from "../core/index.js";
import { language as jsonParser } from "../grammars/json/index.js";
import { check, type Normalize } from "./check.js";
import { synthetic, text, token } from "./doc.js";
import { format } from "./format.js";
import {
  type PrettierOptions,
  prettierDefaults,
  prettierSettings,
} from "./options.js";
import { defineLanguage, type Helpers } from "./rules.js";

const grammar = {
  kinds: ["document", "object", "pair", "array", "string", "number", "comment"],
  tokens: ["{", "}", "[", "]", ",", ":"],
  // `body` is not tree-sitter-json's: it gives the typecheck test a field that exists on a kind other than `pair`.
  fields: { pair: ["key", "value"], document: ["body"] },
  comments: ["comment"],
} as const;

const spec = {
  parser: jsonParser,
  lineComments: { comment: "//" },
  defaults: prettierDefaults,
  settings: prettierSettings,
};

const rules = (h: Helpers<typeof grammar, PrettierOptions>) => ({
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
const plain = defineLanguage(grammar, spec, rules);

/** `format`, and what `check` finds wrong with its output (undefined when nothing is). */
async function run(text: string, language = plain) {
  const tree = parseTree(jsonParser, text);
  const out = format(tree, language);
  if (!out.ok) throw new Error(out.detail);
  return { ...out, problem: check(language, text, out.text) };
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
    expect(out.problem).toBeUndefined();
    expect(out.text).toBe('{ "a": [1, 2], "b": "x" } // end\n');
    for (const { from, to } of out.anchors)
      expect(out.text.slice(...to)).toBe(text.slice(...from).trimEnd());
    expect(out.anchors).toHaveLength(14);
  });

  it("anchors still land on their tokens after line breaks are rewritten as CRLF, so the cursor mapping survives endOfLine", async () => {
    const text = '{"a":[1,2], /* x\n y */ "b":"x"}';
    const tree = parseTree(jsonParser, text);
    const out = format(tree, plain, {
      printWidth: 10,
      endOfLine: "crlf",
    });
    if (!out.ok) throw new Error(out.detail);
    expect(out.text).toContain("/* x\r\n y */");
    expect(out.text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
    for (const { from, to } of out.anchors)
      expect(out.text.slice(...to)).toBe(
        text.slice(...from).replaceAll("\n", "\r\n"),
      );
  });

  it("a rule that drops a token fails the check, so a layout that hides code cannot pass the tests", async () => {
    const dropsColon = defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      pair: h.seq(h.field("key"), h.space, h.field("value")),
    }));
    expect((await run('{"a":1}', dropsColon)).problem).toBeDefined();
  });

  it("a rule that prints a token twice fails the check, so a layout that invents code cannot pass the tests", async () => {
    const repeats = defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      number: (node, ctx) => [
        token(node, ctx.tree.text(node)),
        token(node, ctx.tree.text(node)),
      ],
    }));
    expect((await run("[1]", repeats)).problem).toBeDefined();
  });

  it("a rule that swaps two fields fails the check, so a layout that shows code that does not exist cannot pass the tests", async () => {
    const swaps = defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      pair: h.seq(h.field("value"), ":", h.space, h.field("key")),
    }));
    expect((await run('{"a":1}', swaps)).problem).toBeDefined();
  });

  it("two tokens that trade texts in place fail the check, though each still covers its own range", async () => {
    const trades = defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      number: (node, ctx) =>
        token(node, ctx.tree.text(node) === "1" ? "2" : "1"),
    }));
    expect((await run("[1,2]", trades)).problem).toBeDefined();
  });

  // A string means its cooked value, so a respelling must keep that value.
  const cooked: Normalize = (lexemes) =>
    lexemes.map((l) =>
      l.node.kind === "string" ? `s:${JSON.parse(l.text)}` : l.text,
    );
  const respells = (to: (source: string) => string) =>
    defineLanguage(
      grammar,
      { ...spec, atoms: ["string"], normalize: cooked },
      (h) => ({
        ...rules(h),
        string: (node, ctx) =>
          token(node, to(ctx.tree.text(node))),
      }),
    );

  it("a respelling that changes a string's cooked value fails the check, so a stylistic change that edits data cannot pass the tests", async () => {
    expect(
      (
        await run(
          '["a"]',
          respells(() => '"b"'),
        )
      ).problem,
    ).toBeDefined();
  });

  it("a respelling with the same cooked value is accepted and keeps its node's anchor, so a style option like singleQuote can apply", async () => {
    const out = await run(
      '["\\u0061"]',
      respells((s) => JSON.stringify(JSON.parse(s))),
    );
    expect(out).toMatchObject({
      ok: true,
      text: '["a"]\n',
      problem: undefined,
    });
    expect(out.ok && out.anchors).toContainEqual({ from: [1, 9], to: [1, 4] });
  });

  const semis = (normalize?: Normalize) =>
    defineLanguage(
      grammar,
      { ...spec, ...(normalize && { normalize }) },
      (h) => ({
        ...rules(h),
        pair: (node, ctx) => [rules(h).pair(node, ctx), synthetic(node, ",")],
      }),
    );

  it("an inserted token the language calls optional passes the check and is anchored as synthetic to its node, so an added `,` maps back", async () => {
    const dropsTrailing: Normalize = (lexemes) =>
      lexemes.map((l, i) =>
        l.text === "," && lexemes[i + 1]?.text === "}" ? undefined : l.text,
      );
    const out = await run('{"a":1}', semis(dropsTrailing));
    expect(out).toMatchObject({
      ok: true,
      text: '{ "a": 1, }\n',
      problem: undefined,
    });
    expect(out.ok && out.anchors).toContainEqual({
      from: [1, 6],
      to: [8, 9],
      synthetic: true,
    });
  });

  it("an inserted token the language does not call optional fails the check, so invented code cannot pass the tests", async () => {
    expect((await run('{"a":1}', semis())).problem).toBeDefined();
  });

  it("an unparsable region is kept verbatim rather than rejected, so the rest of the file still formats", async () => {
    const out = await run('[{"a":1,,  "b":2},   3]');
    expect(out).toMatchObject({
      ok: true,
      text: '[{"a":1,,  "b":2}, 3]\n',
      problem: undefined,
    });
  });

  it("a value the parser invented is not printed as an item, so `[1,2,]` never shows as `[1, 2, ]`", async () => {
    expect(await run("[1,2,]")).toMatchObject({
      ok: true,
      text: "[1,2,]\n",
      problem: undefined,
    });
    expect(await run('{"a":1')).toMatchObject({
      ok: true,
      text: '{"a":1\n',
      problem: undefined,
    });
  });

  it("a comment inside an empty list survives, instead of vanishing with the list's items", async () => {
    const out = await run("[ // none\n]");
    expect(out).toMatchObject({
      ok: true,
      text: "[\n  // none\n]\n",
      problem: undefined,
    });
  });

  it("a rule table naming a kind the grammar lacks fails typecheck", () => {
    defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      // @ts-expect-error: `objekt` is not a kind of this grammar
      objekt: h.verbatim(),
    }));
  });

  it("a seq reading a field its kind lacks fails typecheck, instead of printing nothing for it at run time", () => {
    defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      // @ts-expect-error: `body` is a field of `document`, not of `pair`
      pair: h.seq(h.field("body")),
    }));
  });

  it("a seq reaches children in no field by kind or by position, so such a child is printed rather than dropped", async () => {
    const byKind = defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      document: h.seq({ kind: "object" }),
    }));
    const byPosition = defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      document: h.seq({ nth: 0 }),
    }));
    for (const language of [byKind, byPosition])
      expect(await run('{"a" :1}', language)).toMatchObject({
        ok: true,
        text: '{ "a": 1 }\n',
        problem: undefined,
      });
  });

  it("args a rule passes to `print` reach the child's rule, so a parent can steer how a child prints", async () => {
    const marks = defineLanguage(grammar, spec, (h) => ({
      ...rules(h),
      document: (node, ctx) =>
        ctx.items(node).map((n) => ctx.print(n, { mark: "!" })),
      number: (node, ctx, args) => [
        token(node, ctx.tree.text(node)),
        text(String(args?.["mark"] ?? "")),
      ],
    }));
    expect(await run("1", marks)).toMatchObject({ ok: true, text: "1!\n" });
  });
});
