import type { FileDiff, ReviewDoc } from "@hihyou/engine";
import { expect, it } from "vitest";
import { renderPlain } from "./plain.js";

const risk = { score: 0, reasons: [] };

it("folded binary and submodule files print one line and are never read, so an unreadable entry cannot fail the output", async () => {
  const doc: ReviewDoc = {
    schemaVersion: 2,
    diffset: { base: "a".repeat(40), head: "b".repeat(40) },
    files: [
      {
        path: "logo.png",
        status: "added",
        language: null,
        diffMode: "binary",
        fold: "binary",
        edits: [],
        risk,
      },
      {
        path: "vendor/lib",
        status: "modified",
        language: null,
        diffMode: "submodule",
        fold: "submodule",
        edits: [],
        risk,
      },
    ],
    groups: [],
  };
  const lines: string[] = [];
  for await (const line of renderPlain(doc, () => {
    throw new Error("folded file was read");
  }))
    lines.push(line);
  expect(lines.filter((l) => l.includes("folded"))).toEqual([
    "A logo.png  [binary, 0 edits] (folded: binary)",
    "M vendor/lib  [submodule, 0 edits] (folded: submodule)",
  ]);
});

it("a file that fails to load prints its error inline and the files after it still print", async () => {
  const file = (path: string): FileDiff => ({
    path,
    status: "added",
    language: null,
    diffMode: "line",
    fallbackReason: "unsupported-language",
    edits: [
      {
        kind: "insert",
        id: 0,
        new: { start: { line: 1, column: 1 }, end: { line: 1, column: 3 } },
      },
    ],
    risk,
  });
  const doc: ReviewDoc = {
    schemaVersion: 2,
    diffset: { base: "a".repeat(40), head: "b".repeat(40) },
    files: [file("bad.txt"), file("good.txt")],
    groups: [],
  };
  const lines: string[] = [];
  for await (const line of renderPlain(doc, async (index) => {
    if (index === 0) throw new Error("read failed");
    return {
      old: { lines: [], formatted: true },
      new: {
        lines: [{ text: "hi", originalLine: 1, highlights: [] }],
        formatted: true,
      },
      unified: [{ new: 0, changed: true }],
      split: [{ new: 0, changed: true }],
    };
  }))
    lines.push(line);
  expect(lines).toContain(
    "A bad.txt  [line: unsupported-language, 1 edit] (error: read failed)",
  );
  expect(lines.at(-1)).toBe("          1 + hi");
});

it("a file the engine could not read prints its error, instead of being folded away as a zero-edit change", async () => {
  const doc: ReviewDoc = {
    schemaVersion: 2,
    diffset: { base: "a".repeat(40), head: "b".repeat(40) },
    files: [
      {
        path: "lost.ts",
        status: "modified",
        language: "typescript",
        diffMode: "error",
        error: "bad object",
        edits: [],
        risk,
      },
    ],
    groups: [],
  };
  const lines: string[] = [];
  for await (const line of renderPlain(doc, () => {
    throw new Error("error file was read");
  }))
    lines.push(line);
  expect(lines).toContain("M lost.ts  [error, 0 edits] (error: bad object)");
});

it("changes across files print before the files, and every header states its risk with the reasons, so the order can be checked", async () => {
  const doc: ReviewDoc = {
    schemaVersion: 2,
    diffset: { base: "a".repeat(40), head: "b".repeat(40) },
    files: [
      {
        path: "src/text.ts",
        status: "added",
        language: "typescript",
        diffMode: "ast",
        fold: "moved",
        edits: [],
        risk: { score: 1, reasons: [{ signal: "moved", count: 1, points: 1 }] },
      },
    ],
    groups: [
      {
        kind: "move",
        fromPath: "src/util.ts",
        toPath: "src/text.ts",
        names: ["slugify"],
        edits: [0],
        risk: { score: 1, reasons: [{ signal: "moved", count: 1, points: 1 }] },
      },
      {
        kind: "rename-symbol",
        from: "total",
        to: "sumAll",
        path: "src/cart.ts",
        edits: [1, 2],
        risk: {
          score: 2,
          reasons: [{ signal: "renamed", count: 2, points: 2 }],
        },
      },
    ],
  };
  const lines: string[] = [];
  for await (const line of renderPlain(doc, () => {
    throw new Error("folded file was read");
  }))
    lines.push(line);
  expect(lines.slice(3)).toEqual([
    "2 changes across files, riskiest first:",
    "  move slugify: src/util.ts -> src/text.ts, 1 edit  risk 1 (moved +1)",
    "  rename total -> sumAll (declared in src/cart.ts), 2 edits  risk 2 (2x renamed +2)",
    "",
    "A src/text.ts  [ast, 0 edits] risk 1 (moved +1) (folded: moved)",
  ]);
});
