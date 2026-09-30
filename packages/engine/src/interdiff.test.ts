import { parseTree } from "syntechs/core";
import { language } from "syntechs/grammars/typescript";
import { expect, test } from "vitest";
import { nodeAt, stepsOf } from "./anchor.js";
import { syntechsGrammars } from "./grammars.js";
import { createEngine } from "./host.js";
import type { ReviewThread, ReviewThreads } from "./review.js";

const base = `export function keep(x: number) {\n  return x + 1;\n}\n`;
const iter1 = `${base}\nexport function drop(s: string) {\n  return s.trim();\n}\n`;
const iter2 = `export const added = 42;\n\n${base}`;

const blobs: Record<string, string> = { base, iter1, iter2 };

type TestHost = {
  grammars: ReturnType<typeof syntechsGrammars>;
  resolveDiffset(data: "v1" | "v2"): {
    id: string;
    changes: { path: string; before: string; after: string }[];
  };
  readBlob(id: string): Uint8Array;
};

const stepsOfFunction = (text: string, name: string) => {
  const tree = parseTree(language, text);
  const at = text.indexOf(`function ${name}`);
  const root = nodeAt(tree, []) as number;
  for (let ord = 0; ord < tree.nodeCount; ord++) {
    const n = tree.at(ord);
    if (
      n !== root &&
      tree.kindName(n) === "function_declaration" &&
      tree.start(n) === at
    )
      return stepsOf(tree, n);
  }
  throw new Error(`no function ${name}`);
};

// A thread must follow its code into the next iteration, and one whose code is gone must surface, not vanish.
test("port keeps a thread on an unchanged function and sends one on a deleted function to lost", async () => {
  const host: TestHost = {
    grammars: syntechsGrammars(),
    resolveDiffset: (data) => ({
      id: data,
      changes: [
        {
          path: "m.ts",
          before: "base",
          after: data === "v1" ? "iter1" : "iter2",
        },
      ],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  };
  const engine = createEngine(host);
  const v1 = await engine.diffset("v1");
  const v2 = await engine.diffset("v2");

  const thread = (id: string, name: string): ReviewThread<TestHost> => ({
    id,
    anchor: {
      side: "after",
      path: "m.ts",
      nodes: [stepsOfFunction(iter1, name)],
    },
    comments: [],
  });
  const threads: ReviewThreads<TestHost> = {
    diffsetId: v1.id,
    grammars: {},
    ran: [],
    threads: [thread("on-keep", "keep"), thread("on-drop", "drop")],
  };

  const { ported, lost } = await v1.interdiff(v2).port(threads);

  expect(ported.diffsetId).toBe("v2");
  expect(ported.threads.map((t) => t.id)).toEqual(["on-keep"]);
  expect(ported.threads[0]?.anchor.nodes).toEqual([
    stepsOfFunction(iter2, "keep"),
  ]);
  expect(lost.map((t) => t.id)).toEqual(["on-drop"]);
});

// An unlisted file is unchanged, not gone: a thread there must survive an iteration that reverts the file to base.
test("port keeps a thread on an unchanged function in a file the new iteration reverts to base", async () => {
  const host: TestHost = {
    grammars: syntechsGrammars(),
    resolveDiffset: (data) => ({
      id: data,
      changes: [
        { path: "a.ts", before: "base", after: "iter2" },
        ...(data === "v1"
          ? [{ path: "b.ts", before: "base", after: "iter1" }]
          : []),
      ],
    }),
    readBlob: (id) => new TextEncoder().encode(blobs[id] ?? ""),
  };
  const engine = createEngine(host);
  const v1 = await engine.diffset("v1");
  const v2 = await engine.diffset("v2");

  const thread = (
    id: string,
    side: "before" | "after",
    text: string,
  ): ReviewThread<TestHost> => ({
    id,
    anchor: { side, path: "b.ts", nodes: [stepsOfFunction(text, "keep")] },
    comments: [],
  });
  const threads: ReviewThreads<TestHost> = {
    diffsetId: v1.id,
    grammars: {},
    ran: [],
    threads: [
      thread("after", "after", iter1),
      thread("before", "before", base),
    ],
  };

  const { ported, lost } = await v1.interdiff(v2).port(threads);

  expect(lost).toEqual([]);
  expect(ported.threads.map((t) => [t.id, t.anchor.nodes])).toEqual([
    ["after", [stepsOfFunction(base, "keep")]],
    ["before", [stepsOfFunction(base, "keep")]],
  ]);
});

// A rebase shifts every hunk; were hunks compared by position or after-text, upstream edits would read as the author's.
test("a hunk that a rebase only shifted by lines does not appear in the interdiff", async () => {
  const base1 = `export function one() {\n  return 1;\n}\n\nexport function two() {\n  return 2;\n}\n`;
  const base2 = `export const upstream = 0;\n\n${base1}`;
  const author = (base: string, two: string) =>
    base
      .replace("return 1;", "return 10;")
      .replace("return 2;", `return ${two};`);
  const texts: Record<string, string> = {
    base1,
    base2,
    after1: author(base1, "20"),
    after2: author(base2, "22"),
  };
  const host: TestHost = {
    grammars: syntechsGrammars(),
    resolveDiffset: (data) => ({
      id: data,
      changes: [
        data === "v1"
          ? { path: "m.ts", before: "base1", after: "after1" }
          : { path: "m.ts", before: "base2", after: "after2" },
      ],
    }),
    readBlob: (id) => new TextEncoder().encode(texts[id] ?? ""),
  };
  const engine = createEngine(host);
  const v1 = await engine.diffset("v1");
  const v2 = await engine.diffset("v2");

  const files = await v1.interdiff(v2).diff();

  const text = (s: { spans: { text: string }[] }) =>
    s.spans.map((p) => p.text).join("");
  const diffs = files.flatMap((f) =>
    f.fragments.flatMap((g) =>
      g.kind === "diff" ? [[text(g.before), text(g.after)]] : [],
    ),
  );
  expect(diffs).toEqual([["  return 20;\n", "  return 22;\n"]]);
});
