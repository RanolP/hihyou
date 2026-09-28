import { describe, expect, it } from "vitest";
import { buildReviewDoc } from "../doc/build.js";
import type { Edit, FileDiff } from "../doc/schema.js";
import { createSyntaxParser } from "../parse/parser.js";
import { memorySource } from "../source/memory.js";

const parser = createSyntaxParser();

async function files(
  before: Record<string, string>,
  after: Record<string, string>,
): Promise<FileDiff[]> {
  const doc = await buildReviewDoc(memorySource(before, after), { parser });
  return doc.files.toSorted((p, q) => (p.path < q.path ? -1 : 1));
}

const kinds = (f: FileDiff | undefined) =>
  f?.edits.map((e: Edit) =>
    e.kind === "move" && e.edited ? "move edited" : `${e.kind}`,
  );

const body = [
  "const total = items.length;",
  "let sum = 0;",
  "for (const item of items) sum += item.price;",
  "const average = sum / total;",
  "console.log(average);",
  "const rounded = Math.round(average * 100);",
  "if (rounded > limit) warn(rounded);",
  "return rounded / 100;",
];
const helper = (lines: string[]) =>
  `function f(items, limit) {\n${lines.map((l) => `  ${l}\n`).join("")}}\n`;
const outer = "function outer() {\n  setup();\n}\n";
// `f` moves from the top level into `outer`'s body.
const topLevel = (lines: string[]) => `${outer}\n${helper(lines)}`;
const nested = (lines: string[]) =>
  `function outer() {\n  setup();\n${helper(lines)}}\n`;
const fn = (lines: string[]) =>
  `export function load(items, limit) {\n${lines.map((l) => `  ${l}\n`).join("")}}\n`;

describe("a moved node reads as moved, moved and edited, or deleted and new", () => {
  it("a function moved verbatim into another is one pure move, not flagged as edited", async () => {
    const [file] = await files(
      { "m.ts": topLevel(body) },
      { "m.ts": nested(body) },
    );
    expect(kinds(file)).toEqual(["move"]);
  });

  it("a moved function with one of eight statements replaced (token dice ~0.9) stays a move, flagged as edited", async () => {
    const [file] = await files(
      { "m.ts": topLevel(body) },
      { "m.ts": nested(body.with(4, "notify(listeners);")) },
    );
    expect(kinds(file)?.filter((k) => k.startsWith("move"))).toEqual([
      "move edited",
    ]);
  });

  it("a statement under 8 nodes swapped past its sibling is a delete plus an insert, not a move", async () => {
    const [file] = await files(
      { "s.ts": "function f() {\n  a();\n  b();\n}\n" },
      { "s.ts": "function f() {\n  b();\n  a();\n}\n" },
    );
    expect(kinds(file)).toEqual(["delete", "insert"]);
  });

  it("a same-named function moved to another file with a light edit is one cross-file move flagged as edited", async () => {
    const [a, b] = await files(
      { "a.ts": fn(body), "b.ts": "export const x = 1;\n" },
      {
        "a.ts": "",
        "b.ts": `export const x = 1;\n${fn(body.with(4, "notify(listeners);"))}`,
      },
    );
    expect(a?.edits[0]).toMatchObject({ kind: "move", edited: true });
    expect(b?.edits[0]).toMatchObject({ kind: "move", edited: true });
  });

  it("a same-named function moved to another file and rewritten from scratch is a delete there and an insert here, not a move", async () => {
    const rewritten = [
      "const res = await fetch(`/api/${limit}`);",
      "if (!res.ok) throw new HttpError(res.status, res.statusText);",
      "return res.json();",
    ];
    const [a, b] = await files(
      { "a.ts": fn(body), "b.ts": "export const x = 1;\n" },
      { "a.ts": "", "b.ts": `export const x = 1;\n${fn(rewritten)}` },
    );
    expect(kinds(a)).toEqual(["delete"]);
    expect(kinds(b)).toEqual(["insert"]);
  });
});
