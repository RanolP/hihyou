import type { FileDiff, Span } from "@hihyou/engine";
import { expect, test } from "vitest";
import {
  buildSections,
  type DiffFile,
  gapOf,
  type MergedSpan,
  unifiedRows,
} from "./rows.js";

// Pairing a row by row index instead of per-side line numbers shows a 2-line removal against a 1-line
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
  expect(sections.map((s) => s.path)).toEqual([["class A"], [], []]);
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
    origin: { before: 13, after: 22 },
    lines: { before: 13, after: 22 },
    count: 5,
    revealed: false,
    atStart: false,
    atEnd: false,
  });
});

// Miscounting what a partial expand revealed numbers the remaining gap wrong, so the next "expand up" asks the
// engine for lines already on screen and shows them twice.
test("lines revealed from both edges of a gap shrink it from those edges", () => {
  const unchanged = (before: number, after: number, text: string) => ({
    kind: "unchanged" as const,
    spans: [{ text }],
    at: [],
    lines: { before, after },
  });
  const file: DiffFile = {
    path: "a.ts",
    fragments: [
      { kind: "elided", lines: { before: 3, after: 5 } },
      unchanged(53, 55, "z\n"),
    ],
    revealed: {
      0: {
        top: [unchanged(3, 5, "a\nb\n")],
        bottom: [unchanged(50, 52, "x\ny\nw\n")],
      },
    },
  };
  const rows = buildSections(file).flatMap((s) => s.rows);
  expect(
    rows.map((r) => (r.kind === "unchanged" ? r.after.line : r.kind)),
  ).toEqual([5, 6, "elided", 52, 53, 54, 55]);
  expect(gapOf(file, 0)).toMatchObject({
    lines: { before: 5, after: 7 },
    count: 45,
    revealed: true,
  });
});

// Taking `last` from the longer side's row count leaves a moved block shorter than its other side unclosed:
// its yellow box gets no bottom edge, and the box bleeds into the rows below.
test("a moved side shorter than the other closes its box on its own last line", () => {
  const moves = [{ first: 1, last: 2, counterpart: { path: "b.ts", at: [] } }];
  const file: FileDiff = {
    path: "a.ts",
    fragments: [
      {
        kind: "diff",
        before: { spans: [{ text: "m\nn\n" }], at: [], startLine: 1, moves },
        after: { spans: [{ text: "x\ny\nz\n" }], at: [], startLine: 1 },
      },
    ],
  };
  const rows = buildSections(file)[0]?.rows ?? [];
  expect(rows.map((r) => (r.kind === "diff" ? r.moved : undefined))).toEqual([
    { before: { last: false } },
    { before: { last: true } },
    undefined,
  ]);
});

// Boxing every line of a side that holds a move drew the call around an inlined argument as moved too, and
// kept the call's unchanged-but-for-the-argument line from merging with its old self.
test("a move over some of a side's lines boxes only those lines, and the rest still merge", () => {
  const counterpart = { path: "a.ts", at: [] };
  const file: FileDiff = {
    path: "a.ts",
    fragments: [
      {
        kind: "diff",
        before: { spans: [{ text: "track" }, { text: "(done)", changed: true }, { text: "\n" }], at: [], startLine: 6 },
        after: {
          spans: [{ text: "track" }, { text: "(", changed: true }, { text: "\n  exit(id),\n" }, { text: ")", changed: true }, { text: "\n" }],
          at: [],
          startLine: 5,
          moves: [{ first: 6, last: 6, counterpart }],
        },
      },
    ],
  };
  const rows = buildSections(file)[0]?.rows ?? [];
  expect(rows.map((r) => (r.kind === "diff" ? [r.move, r.moved] : r.kind))).toEqual([
    [undefined, undefined],
    [{ after: { first: 6, last: 6, counterpart } }, { after: { last: true } }],
    [undefined, undefined],
  ]);
  expect(unifiedRows(rows).map((r) => (r.kind === "line" ? `${r.side}${r.moved ? " moved" : ""}` : r.kind))).toEqual([
    "merged",
    "after moved",
    "after",
  ]);
});

const pairedLine = (before: Span[], after: Span[]): FileDiff => ({
  path: "a.ts",
  fragments: [
    {
      kind: "diff",
      before: { spans: before, at: [], startLine: 13 },
      after: { spans: after, at: [], startLine: 13 },
    },
  ],
});

// Splitting a paired line into a "-" and a "+" line (or dropping one side's changed node) loses the inline view
// that shows a rename as one line with the old and the new name side by side.
test("a paired line with one renamed identifier renders as one line holding both the del and ins nodes", () => {
  const file = pairedLine(
    [
      { text: "for (u of " },
      { text: "updates", changed: true },
      { text: ") {\n" },
    ],
    [
      { text: "for (u of " },
      { text: "changes", changed: true },
      { text: ") {\n" },
    ],
  );
  expect(unifiedRows(buildSections(file)[0]?.rows ?? [])).toEqual([
    {
      kind: "merged",
      fragment: 0,
      before: 13,
      after: 13,
      spans: [
        { text: "for (u of " },
        { text: "updates", changed: true, side: "before" },
        { text: "changes", changed: true, side: "after" },
        { text: ") {" },
      ],
    },
  ]);
});

// Interleaving two lines whose unchanged text differs would print text from neither side as if it were shared.
test("a paired line whose unchanged text differs falls back to a removed line then an added line", () => {
  const file = pairedLine(
    [{ text: "  " }, { text: "log", changed: true }, { text: "(u)\n" }],
    [
      { text: "  " },
      { text: "await queue", changed: true },
      { text: "(u);\n" },
    ],
  );
  expect(
    unifiedRows(buildSections(file)[0]?.rows ?? []).map((r) =>
      r.kind === "line" ? [r.side, r.cell.line] : r.kind,
    ),
  ).toEqual([
    ["before", 13],
    ["after", 13],
  ]);
});

// Merging only positionally paired lines renders a one-line object literal reflowed onto four lines as a removed
// line plus four added lines, so code that did not change reads as deleted and re-added.
test("an object literal reflowed onto several lines with one property added renders merged, not as a removed line and added lines", () => {
  const file: FileDiff = {
    path: "a.ts",
    fragments: [
      {
        kind: "diff",
        before: {
          spans: [{ text: "  { min: a ? b : c },\n" }],
          at: [],
          startLine: 7,
        },
        after: {
          spans: [
            { text: "  {\n    " },
            { text: "pad: inset,", changed: true },
            { text: "\n    min: a ? b : c" },
            { text: ",", changed: true },
            { text: "\n  },\n" },
          ],
          at: [],
          startLine: 7,
        },
      },
    ],
  };
  const text = (spans: MergedSpan[]) =>
    spans
      .map((s) =>
        !s.changed
          ? s.text
          : s.side === "before"
            ? `[-${s.text}-]`
            : `{+${s.text}+}`,
      )
      .join("");
  expect(
    unifiedRows(buildSections(file)[0]?.rows ?? []).map((r) =>
      r.kind === "merged" ? [r.before, r.after, text(r.spans)] : r.kind,
    ),
  ).toEqual([
    [7, 7, "  {"],
    [undefined, 8, "    {+pad: inset,+}"],
    [undefined, 9, "    min: a ? b : c{+,+}"],
    [undefined, 10, "  },"],
  ]);
});

// Heading every section repeats the enclosing declaration over hunks the reader is already reading continuously,
// and puts a breadcrumb over runs of nothing but hidden lines; a header belongs only where a hidden gap cut the
// reader off from a declaration, and it goes away once that gap is revealed.
test("a heading shows only where a hidden gap broke continuity, never over hidden lines alone", () => {
  const unchanged = (line: number, text: string) => ({
    kind: "unchanged" as const,
    spans: [{ text }],
    at: [],
    lines: { before: line, after: line },
  });
  const diff = (line: number, from: string, to: string) => ({
    kind: "diff" as const,
    before: {
      spans: [{ text: `${from}\n`, changed: true }],
      at: [],
      startLine: line,
    },
    after: {
      spans: [{ text: `${to}\n`, changed: true }],
      at: [],
      startLine: line,
    },
  });
  const file: DiffFile = {
    path: "a.ts",
    fragments: [
      { kind: "elided", lines: { before: 1, after: 1 } },
      { kind: "begin", label: "function f", at: [0] },
      unchanged(10, "  a\n"),
      { kind: "begin", label: "if (x)", at: [0, 1] },
      diff(11, "  if (x) y", "  if (x) z"),
      { kind: "end", label: "if (x)" },
      diff(12, "  p", "  q"),
      unchanged(13, "  b\n"),
      { kind: "elided", lines: { before: 14, after: 14 } },
      unchanged(20, "  c\n}\n"),
      { kind: "end", label: "function f" },
      { kind: "elided", lines: { before: 22, after: 22 } },
      { kind: "begin", label: "function g", at: [1] },
      unchanged(30, "  d\n"),
      diff(31, "  r", "  s"),
      { kind: "end", label: "function g" },
    ],
  };
  const headed = (f: DiffFile) =>
    buildSections(f)
      .filter((s) => s.heading)
      .map((s) => s.path);
  expect(headed(file)).toEqual([["function f"], ["function g"]]);
  const lines = Array.from({ length: 9 }, (_, i) => `l${i + 1}\n`).join("");
  expect(
    headed({
      ...file,
      revealed: { 0: { top: [unchanged(1, lines)], bottom: [] } },
    }),
  ).toEqual([["function g"]]);
});
