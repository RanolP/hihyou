import type { FileDiff } from "@hihyou/engine";
import { expect, test } from "vitest";
import { buildSections } from "./rows.js";

// Pairing a split row by row index instead of per-side line numbers shows a 2-line removal against a 1-line
// addition with the wrong numbers, and dropping `changed` at a newline un-highlights half of a multi-line edit.
test("a diff fragment numbers each side on its own and keeps emphasis across a newline", () => {
  const file: FileDiff = {
    path: "a.ts",
    fragments: [
      { kind: "begin", label: "class A", at: [0] },
      {
        kind: "unchanged",
        spans: [{ text: "x;\n" }],
        at: [],
        lines: { before: 10, after: 20 },
      },
      {
        kind: "diff",
        before: {
          spans: [
            { text: "a" },
            { text: "b\nc", changed: true },
            { text: "\n" },
          ],
          at: [],
          startLine: 11,
        },
        after: { spans: [{ text: "d\n" }], at: [], startLine: 21 },
      },
      { kind: "end", label: "class A" },
      { kind: "elided", lines: { before: 13, after: 22 } },
      {
        kind: "unchanged",
        spans: [{ text: "y\n" }],
        at: [],
        lines: { before: 18, after: 27 },
      },
    ],
  };
  const sections = buildSections(file);
  expect(sections.map((s) => s.path)).toEqual([["class A"], []]);
  expect(sections[0]?.rows).toEqual([
    {
      kind: "unchanged",
      before: { line: 10, spans: [{ text: "x;" }] },
      after: { line: 20, spans: [{ text: "x;" }] },
    },
    {
      kind: "diff",
      fragment: 2,
      before: {
        line: 11,
        spans: [{ text: "a" }, { text: "b", changed: true }],
      },
      after: { line: 21, spans: [{ text: "d" }] },
    },
    {
      kind: "diff",
      fragment: 2,
      before: { line: 12, spans: [{ text: "c", changed: true }] },
    },
  ]);
  expect(sections[1]?.rows[0]).toEqual({
    kind: "elided",
    fragment: 4,
    lines: { before: 13, after: 22 },
    count: 5,
  });
});
