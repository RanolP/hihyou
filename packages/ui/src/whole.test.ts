import type { NodeOutline, Side } from "@hihyou/engine";
import { expect, test } from "vitest";
import { atomIndex } from "./atoms.js";
import type { DiffFile } from "./rows.js";
import { viewState, wholeHeaders, wholeText } from "./whole.js";

const n = (
  parent: number,
  line: number,
  extra: Partial<NodeOutline> = {},
): NodeOutline => ({
  steps: [],
  parent,
  kind: "node",
  start: { line, column: 0 },
  end: { line: line + 1, column: 0 },
  changed: extra.atom !== undefined,
  hash: "",
  ...extra,
});
const side = (nodes: NodeOutline[], startLine = 1): Side => ({
  spans: [],
  at: [],
  startLine,
  nodes,
});
const file = (after: NodeOutline[], status?: "added"): DiffFile => ({
  path: "a.ts",
  fragments: [{ kind: "diff", before: side([]), after: side(after, 10) }],
  ...(status && { status }),
});

// Regression: a whole unit without a label reads "added undefined" or nothing at all.
test("a whole unit reads its label, or 'block' without one", () => {
  expect(wholeText(n(-1, 0, { whole: "added", label: "function extra" }))).toBe(
    "added function extra",
  );
  expect(wholeText(n(-1, 0, { whole: "deleted" }))).toBe("deleted block");
  expect(wholeText(n(-1, 0))).toBeUndefined();
});

// Regression: an added file repeats "added block" over every top statement, restating the file badge.
test("an added file heads only its declarations; a changed file heads every whole unit", () => {
  const nodes = [
    n(-1, 0, { whole: "added" }),
    n(-1, 2, { whole: "added", label: "class Shop" }),
    n(1, 3, { atom: "x" }),
  ];
  const added = wholeHeaders(file(nodes, "added"), 4);
  expect([...added.entries()]).toEqual([
    [
      "0:after:12",
      {
        ref: { file: 4, fragment: 0, side: "after", node: 1 },
        text: "added class Shop",
        whole: "added",
      },
    ],
  ]);
  const changed = wholeHeaders(file(nodes), 4);
  expect([...changed.keys()]).toEqual(["0:after:10", "0:after:12"]);
});

// Regression: a host that sends only `change` (no engine `status`) loses the added-file rule.
test("the host's change marks the file added when the engine's status is absent", () => {
  const f: DiffFile = {
    ...file([n(-1, 0, { whole: "added" })]),
    change: { path: "a.ts", before: null, after: "b" },
  };
  expect(wholeHeaders(f, 0).size).toBe(0);
});

// Regression: marking one leaf inside a whole unit shows the unit as viewed (or as untouched).
test("a whole unit is partial until every atom beneath it is viewed", () => {
  const index = atomIndex([
    file([
      n(-1, 0, { whole: "added", label: "function f" }),
      n(0, 0, { atom: "a" }),
      n(0, 0, { atom: "b" }),
    ]),
  ]);
  const t = { kind: "node", file: 0, fragment: 0, side: "after", node: 0 } as const;
  expect(viewState(index, t, () => false)).toBe("unviewed");
  expect(viewState(index, t, (a) => a === "a")).toBe("partial");
  expect(viewState(index, t, () => true)).toBe("viewed");
});
