import type { FileDiff, ReviewDoc } from "@hihyou/engine";
import { expect, it } from "vitest";
import { renderPlain } from "./plain.js";

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
      },
      {
        path: "vendor/lib",
        status: "modified",
        language: null,
        diffMode: "submodule",
        fold: "submodule",
        edits: [],
      },
    ],
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
        new: { start: { line: 1, column: 1 }, end: { line: 1, column: 3 } },
      },
    ],
  });
  const doc: ReviewDoc = {
    schemaVersion: 2,
    diffset: { base: "a".repeat(40), head: "b".repeat(40) },
    files: [file("bad.txt"), file("good.txt")],
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
      },
    ],
  };
  const lines: string[] = [];
  for await (const line of renderPlain(doc, () => {
    throw new Error("error file was read");
  }))
    lines.push(line);
  expect(lines).toContain("M lost.ts  [error, 0 edits] (error: bad object)");
});
