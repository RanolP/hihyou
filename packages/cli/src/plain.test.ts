import type { ReviewDoc } from "@hihyou/engine";
import { expect, it } from "vitest";
import { renderPlain } from "./plain.js";

it("folded binary and submodule files print one line and are never read, so an unreadable entry cannot fail the output", async () => {
  const doc: ReviewDoc = {
    schemaVersion: 1,
    diffset: { base: "a".repeat(40), head: "b".repeat(40) },
    files: [
      {
        path: "logo.png",
        status: "added",
        language: null,
        diffMode: "binary",
        edits: [],
      },
      {
        path: "vendor/lib",
        status: "modified",
        language: null,
        diffMode: "submodule",
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
