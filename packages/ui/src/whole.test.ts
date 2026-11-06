import type { NodeOutline, Side } from "@hihyou/engine";
import { expect, test } from "vitest";
import type { DiffFile } from "./rows.js";
import { wholeStarts } from "./whole.js";

/** A node spanning two lines, so it is long enough for a rule. */
const n = (
  parent: number,
  line: number,
  extra: Partial<NodeOutline> = {},
): NodeOutline => ({
  steps: [],
  parent,
  kind: "node",
  start: { line, column: 0 },
  end: { line: line + 2, column: 0 },
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

// Regression: an added file rules off every top statement, where the file badge already says they are new.
test("an added file rules off only its declarations; a changed file every whole unit", () => {
  const nodes = [
    n(-1, 0, { whole: "added" }),
    n(-1, 2, { whole: "added", label: "class Shop" }),
    n(1, 3, { atom: "x" }),
  ];
  expect([...wholeStarts(file(nodes, "added"))]).toEqual(["0:after:12"]);
  expect([...wholeStarts(file(nodes))]).toEqual(["0:after:10", "0:after:12"]);
});

// Regression: a host that sends only `change` (no engine `status`) loses the added-file rule.
test("the host's change marks the file added when the engine's status is absent", () => {
  const f: DiffFile = {
    ...file([n(-1, 0, { whole: "added" })]),
    change: { path: "a.ts", before: null, after: "b" },
  };
  expect(wholeStarts(f).size).toBe(0);
});
