import type { FileDiff, Side } from "@hihyou/engine";
import { expect, test } from "vitest";
import { approvalOf } from "./approval.js";
import {
  atomIndex,
  atomViewed,
  type NodeOutline,
  type NodeRef,
  nodeScore,
  writeAtoms,
  writeScores,
} from "./atoms.js";
import {
  plainKeyOf,
  type Score,
  sessionScoreStore,
  sessionViewedStore,
} from "./viewed.js";

const n = (parent: number, line: number, atom?: string): NodeOutline => ({
  steps: [line],
  parent,
  kind: "node",
  start: { line, column: 0 },
  end: { line: line + 1, column: 0 },
  changed: atom !== undefined,
  hash: atom ?? `h${line}`,
  ...(atom === undefined ? {} : { atom }),
});
const side = (nodes: NodeOutline[]): Side => ({
  spans: [],
  at: [],
  startLine: 1,
  nodes,
});

/** a.ts: class C { X -> X'; insert Z }; b.ts: insert W. Three edits: u1, i1, i2. */
const files: FileDiff[] = [
  {
    path: "a.ts",
    fragments: [
      {
        kind: "diff",
        before: side([n(-1, 0), n(0, 1, "u1")]),
        after: side([n(-1, 0), n(0, 1, "u1"), n(0, 2, "i1")]),
      },
    ],
  },
  {
    path: "b.ts",
    fragments: [
      { kind: "diff", before: side([]), after: side([n(-1, 0, "i2")]) },
    ],
  },
];
const index = atomIndex(files);
const ref = (file: number, s: "before" | "after", node: number): NodeRef => ({
  file,
  fragment: 0,
  side: s,
  node,
});
const classAfter = ref(0, "after", 0);
const xBefore = ref(0, "before", 1);
const w = ref(1, "after", 0);

const review = () => {
  const store = sessionScoreStore();
  const viewed = sessionViewedStore();
  const score = (nodes: NodeRef[], s: Score | null) =>
    writeScores(index, nodes, s, store, plainKeyOf);
  const view = (atoms: string[]) => writeAtoms(atoms, true, viewed, plainKeyOf);
  const approval = () =>
    approvalOf(
      index,
      nodeScore(index, store, plainKeyOf),
      atomViewed(viewed, plainKeyOf),
    );
  return { store, score, view, approval };
};

test("nothing scored reads pending, with every edit counted", () => {
  expect(review().approval()).toEqual({
    state: "pending",
    heaviest: null,
    read: 0,
    edits: 3,
  });
});

// A +2 on part of the Diffset read as approval while an edit nobody read was still in it.
test("an edit nobody scored keeps all-+2 scores from reading approved", () => {
  const r = review();
  r.score([classAfter], 2);
  expect(r.approval()).toEqual({
    state: "pending",
    heaviest: 2,
    read: 2,
    edits: 3,
  });
  r.score([w], 2);
  expect(r.approval().state).toBe("approved");
});

// A score on a parent node, or on the before half of an update, left the edits it covers unscored.
test("a score covers the edits beneath its node, from either side of an update", () => {
  const r = review();
  r.score([xBefore], 2);
  expect(r.approval().read).toBe(1);
  r.score([classAfter, w], 2);
  expect(r.approval()).toMatchObject({ state: "approved", read: 3 });
});

// Averaging or taking the latest score let a -2 be outvoted by +2s around it.
test("one -2 blocks even when every edit also carries a +2", () => {
  const r = review();
  r.score([classAfter, w], 2);
  r.score([xBefore], -2);
  expect(r.approval()).toMatchObject({ state: "blocked", heaviest: -2 });
  r.score([xBefore], null);
  expect(r.approval().state).toBe("approved");
});

// +1 means "someone else should also look", so treating it as approval merged code on a +1.
test("+1 or -1 on every edit is not approval", () => {
  const r = review();
  r.score([classAfter, w], 1);
  expect(r.approval()).toMatchObject({ state: "pending", heaviest: 1 });
  r.score([w], -1);
  expect(r.approval()).toMatchObject({ state: "pending", heaviest: -1 });
});

// The store outlives one iteration; a -2 kept for a node whose code has since changed blocked the new one.
test("a score on a node outside this Diffset never counts", () => {
  const r = review();
  r.score([classAfter, w], 2);
  r.store.setMany(
    [
      plainKeyOf({
        kind: "node",
        path: "a.ts",
        side: "after",
        steps: [1],
        hash: "old",
      }),
    ],
    -2,
  );
  expect(r.approval().state).toBe("approved");
});

// Viewing implies +1 ("viewed로 마킹하면 +1이라는 것을 암시"): without it a viewed edit read as unread, and with it
// stored or outranking a score, a viewed edit hid an explicit -1 or turned +2s into approval it never had.
test("a viewed edit counts as +1 unless an explicit score covers it", () => {
  const r = review();
  r.score([classAfter], 2);
  r.view(["i2"]);
  expect(r.approval()).toEqual({
    state: "pending",
    heaviest: 1,
    read: 3,
    edits: 3,
  });
  // Only the class's own +2 is stored; the implied +1 is not.
  expect(Object.keys(r.store.state())).toHaveLength(1);
  r.score([w], 2);
  expect(r.approval().state).toBe("approved");
  r.score([w], -1);
  expect(r.approval()).toMatchObject({ state: "pending", heaviest: -1 });
});
