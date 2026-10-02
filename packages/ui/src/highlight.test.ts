import { expect, test } from "vitest";
import {
  cutShared,
  piecesIn,
  type Placed,
  skeletonOf,
} from "./highlight.js";

// A merged unified row draws the before side's unchanged text once, as after text; without a before place for it,
// `o` onto a before node lights only its changed text. A reflow must cut the shared text where the before copy
// breaks lines, and whitespace the before copy lacks must stay out of the before piece.
test("shared text of a merged row is placed on the before side, cut where the before copy reflows", () => {
  const before = [
    {
      line: 7,
      spans: [
        { text: "f(", changed: false },
        { text: "old", changed: true },
        { text: ", a,", changed: false },
      ],
    },
    { line: 8, spans: [{ text: "  b)", changed: false }] },
  ];
  const skeleton = skeletonOf(before);
  // The after line reads `f(new, a, b)`: its shared text `f(` then `, a, b)`.
  const first = cutShared("f(", skeleton, 0);
  expect(first.cuts).toEqual([{ text: "f(", before: { line: 7, column: 0 } }]);
  const rest = cutShared(", a, b)", skeleton, first.next);
  expect(rest.cuts).toEqual([
    { text: ", a,", before: { line: 7, column: 5 } },
    { text: " " },
    { text: "b)", before: { line: 8, column: 2 } },
  ]);
  expect(rest.next).toBe(skeleton.length);
});

// A node that starts mid-span and runs onto a later line must cut the first and last spans at its columns and
// take every span of the lines between; an off-by-one here paints a neighbour's text or drops the node's edge.
test("a multi-line node cuts the spans it starts and ends in", () => {
  const lines: Placed<string>[][] = [
    [
      { item: "const ", start: 0, length: 6 },
      { item: "x = {", start: 6, length: 5 },
    ],
    [{ item: "  a: 1,", start: 0, length: 7 }],
    [
      { item: "}", start: 0, length: 1 },
      { item: ";", start: 1, length: 1 },
    ],
  ];
  const at = (line: number) => lines[line];
  expect(piecesIn(at, { line: 0, column: 10 }, { line: 2, column: 1 })).toEqual(
    [
      { item: "x = {", from: 4, to: 5 },
      { item: "  a: 1,", from: 0, to: 7 },
      { item: "}", from: 0, to: 1 },
    ],
  );
  // Within one line, a node ending where the next span starts leaves that span out.
  expect(piecesIn(at, { line: 0, column: 2 }, { line: 0, column: 6 })).toEqual([
    { item: "const ", from: 2, to: 6 },
  ]);
});
