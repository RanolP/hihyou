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
