import { expect, test } from "vitest";
import {
  movePair,
  pairSubject,
  pairUnifiedRows,
  type SideRef,
} from "./moves.js";
import type { DiffFile } from "./rows.js";
import { plainKeyOf, sessionViewedStore } from "./viewed.js";

/** `trim` moves from util.ts (lines 3-5) into text.ts (lines 1-3), its call edited on the way. */
const files: DiffFile[] = [
  {
    path: "src/util.ts",
    fragments: [
      {
        kind: "diff",
        before: {
          spans: [
            { text: "function trim(s) {\n  return s." },
            { text: "trim", changed: true },
            { text: "();\n}\n" },
          ],
          at: [[2]],
          startLine: 3,
          moves: [
            {
              first: 3,
              last: 5,
              counterpart: { path: "src/text.ts", at: [[0]] },
            },
          ],
        },
        after: { spans: [], at: [], startLine: 3 },
      },
    ],
  },
  {
    path: "src/text.ts",
    fragments: [
      {
        kind: "diff",
        before: { spans: [], at: [], startLine: 1 },
        after: {
          spans: [
            { text: "function trim(s) {\n  return s." },
            { text: "trimEnd", changed: true },
            { text: "();\n}\n" },
          ],
          at: [[0]],
          startLine: 1,
          moves: [
            {
              first: 1,
              last: 3,
              counterpart: { path: "src/util.ts", at: [[2]] },
            },
          ],
        },
      },
    ],
  },
];
const source: SideRef = { file: 0, fragment: 0, side: "before", move: 0 };
const target: SideRef = { file: 1, fragment: 0, side: "after", move: 0 };

// A key built from the half a file holds marks only that file, so the target still reads unviewed after the
// reviewer looked at the move from its source.
test("viewing a cross-file move in the source file marks it viewed in the target file", () => {
  const fromSource = movePair(files, source);
  const fromTarget = movePair(files, target);
  if (!fromSource || !fromTarget) throw new Error("pair not found");
  expect(fromSource.crossFile).toBe(true);
  const store = sessionViewedStore({ device: "d" });
  store.set(plainKeyOf(pairSubject(fromSource)), true);
  expect(store.get(plainKeyOf(pairSubject(fromTarget)))).toBe(true);
});

// The expansion reads the other file's half: without it a focused block shows only the lines already on screen.
test("focusing a cross-file moved block renders the counterpart lines as an inner diff", () => {
  const pair = movePair(files, source);
  if (!pair) throw new Error("pair not found");
  const unified = pairUnifiedRows(pair);
  expect(
    unified.map((r) =>
      r.kind === "merged"
        ? `${r.before}/${r.after} ${r.spans.map((s) => (s.side ? `[${s.side === "before" ? "-" : "+"}${s.text}]` : s.text)).join("")}`
        : r.kind,
    ),
  ).toEqual([
    "3/1 function trim(s) {",
    "4/2   return s.[-trim][+trimEnd]();",
    "5/3 }",
  ]);
});
