import { describe, expect, it } from "vitest";
import { parseTree } from "../core/index.js";
import { json } from "../grammars/json/fmt.js";
import { language as jsonParser } from "../grammars/json/index.js";
import { check, identity, type Normalize } from "./check.js";
import { format } from "./format.js";
import type { Language } from "./rules.js";
import { sText, sToken } from "./stream.js";
import type { StreamRule } from "./stream-format.js";

type Json = Language<typeof json.defaults>;

/** JSON with `rules` over its own, and `spec` over its language fields. */
const withRules = (
  rules: Record<string, StreamRule>,
  spec: Partial<Omit<Json, "stream">> = {},
): Json => {
  const merged = new Map(json.stream.rules);
  for (const [k, r] of Object.entries(rules)) merged.set(k, r);
  return { ...json, ...spec, stream: { ...json.stream, rules: merged } };
};

const pairRule = json.stream.rules.get("pair") as StreamRule;
const pairOf = (node: number, ctx: Parameters<StreamRule>[1]) =>
  ctx.items(node) as [number, number];

/** `format`, and what `check` finds wrong with its output (undefined when nothing is). */
async function run(text: string, language: Json = json) {
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
    const out = format(tree, json, {
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
    const dropsColon = withRules({
      pair: (node, ctx) => {
        const [key, value] = pairOf(node, ctx);
        ctx.print(key);
        sText(" ");
        ctx.print(value);
      },
    });
    expect((await run('{"a":1}', dropsColon)).problem).toBeDefined();
  });

  it("a rule that prints a token twice fails the check, so a layout that invents code cannot pass the tests", async () => {
    const repeats = withRules({
      number: (node, ctx) => {
        sToken(node, ctx.tree.text(node));
        sToken(node, ctx.tree.text(node));
      },
    });
    expect((await run("[1]", repeats)).problem).toBeDefined();
  });

  it("a rule that swaps two fields fails the check, so a layout that shows code that does not exist cannot pass the tests", async () => {
    const swaps = withRules({
      pair: (node, ctx) => {
        const [key, value] = pairOf(node, ctx);
        ctx.print(value);
        sText(": ");
        ctx.print(key);
      },
    });
    expect((await run('{"a":1}', swaps)).problem).toBeDefined();
  });

  it("two tokens that trade texts in place fail the check, though each still covers its own range", async () => {
    const trades = withRules({
      number: (node, ctx) =>
        sToken(node, ctx.tree.text(node) === "1" ? "2" : "1"),
    });
    expect((await run("[1,2]", trades)).problem).toBeDefined();
  });

  // A string means its cooked value, so a respelling must keep that value.
  const cooked: Normalize = (lexemes, _text, tree) =>
    lexemes.map((l) =>
      tree.kindName(l.node) === "string" ? `s:${JSON.parse(l.text)}` : l.text,
    );
  const respells = (to: (source: string) => string) =>
    withRules(
      { string: (node, ctx) => sToken(node, to(ctx.tree.text(node))) },
      { atoms: new Set(["string"]), normalize: cooked, layoutBlind: false },
    );

  it("a respelling that changes a string's cooked value fails the check, so a stylistic change that edits data cannot pass the tests", async () => {
    expect((await run('["a"]', respells(() => '"b"'))).problem).toBeDefined();
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

  const semis = (normalize: Normalize) =>
    withRules(
      {
        pair: (node, ctx) => {
          pairRule(node, ctx);
          sToken(node, ",", true);
        },
      },
      { normalize, layoutBlind: false },
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
    expect((await run('{"a":1}', semis(identity))).problem).toBeDefined();
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
});
