import type { FileDiff, Side } from "@hihyou/engine";
import { expect, test } from "vitest";
import {
  atomIndex,
  atomViewed,
  type NodeOutline,
  nodeScore,
  type Target,
  viewedOf,
} from "./atoms.js";
import {
  bindModal,
  emptyModal,
  type ModalContext,
  type ModalRoot,
  type ModalState,
  modalKey,
  selectAt,
} from "./modal.js";
import { plainKeyOf, sessionScoreStore, sessionViewedStore } from "./viewed.js";

const n = (
  parent: number,
  line: number,
  endLine: number,
  atom?: string,
): NodeOutline => ({
  steps: [line, endLine],
  parent,
  kind: "node",
  start: { line, column: 0 },
  end: { line: endLine, column: 0 },
  changed: atom !== undefined,
  hash: atom ?? "",
  ...(atom === undefined ? {} : { atom }),
});
const side = (nodes: NodeOutline[]): Side => ({
  spans: [],
  at: [],
  startLine: 1,
  nodes,
});

/**
 * a.ts: class C { m1 { X -> X'; delete Y; insert Z } m2 {} m3 {} } where m3 moves to b.ts; after an elided run,
 * a second hunk inserts a function. b.ts receives m3 and inserts one more node.
 */
const files: FileDiff[] = [
  {
    path: "a.ts",
    fragments: [
      { kind: "begin", label: "class C", at: [0] },
      {
        kind: "diff",
        before: side([
          n(-1, 0, 9), // 0 class
          n(0, 1, 4), // 1 m1
          n(1, 2, 3, "u1"), // 2 X
          n(1, 3, 4, "d1"), // 3 Y
          n(0, 5, 6), // 4 m2, untouched
          n(0, 6, 8, "mv"), // 5 m3, moved out
        ]),
        after: side([
          n(-1, 0, 6), // 0 class
          n(0, 1, 4), // 1 m1
          n(1, 2, 3, "u1"), // 2 X'
          n(1, 3, 4, "i1"), // 3 Z
        ]),
      },
      { kind: "end", label: "class C" },
      { kind: "elided", lines: { before: 11, after: 8 } },
      {
        kind: "diff",
        before: side([]),
        after: side([n(-1, 0, 2, "i2")]),
      },
    ],
  },
  {
    path: "b.ts",
    fragments: [
      {
        kind: "diff",
        before: side([]),
        after: side([n(-1, 0, 2, "mv"), n(-1, 3, 4, "i3")]),
      },
    ],
  },
];
const index = atomIndex(files);
const nd = (
  file: number,
  fragment: number,
  s: "before" | "after",
  node: number,
): Target => ({ kind: "node", file, fragment, side: s, node });
const at = (t: Target): ModalState => ({ ...emptyModal, selections: [t] });

const ctxWith = (viewed: string[] = []): ModalContext => ({
  index,
  isViewed: (a) => viewed.includes(a),
});
const press = (s: ModalState, keys: string, ctx = ctxWith()) => {
  for (const k of keys) s = modalKey(s, k, ctx)?.state ?? s;
  return s;
};
const walk = (s: ModalState, key: string, times: number, ctx = ctxWith()) =>
  Array.from({ length: times }, () => (s = press(s, key, ctx)).selections[0]);

// A parent read as viewed once any one atom under it was, so a half-reviewed method disappeared from "unviewed".
test("a node, hunk or file is viewed only when every atom beneath it is", () => {
  const m1 = nd(0, 1, "before", 1);
  const hunk: Target = { kind: "hunk", file: 0, fragment: 1 };
  expect(viewedOf(index, m1, (a) => a === "u1")).toBe(false);
  expect(viewedOf(index, m1, (a) => ["u1", "d1"].includes(a))).toBe(true);
  expect(viewedOf(index, hunk, (a) => ["u1", "d1", "mv"].includes(a))).toBe(
    false,
  );
  expect(
    viewedOf(index, hunk, (a) => ["u1", "d1", "mv", "i1"].includes(a)),
  ).toBe(true);
  // m2 holds no edit, so it has nothing to mark.
  expect(viewedOf(index, nd(0, 1, "before", 4), () => true)).toBeUndefined();
  expect(viewedOf(index, { kind: "file", file: 0 }, (a) => a !== "i2")).toBe(
    false,
  );
});

// o/i/n/p walked the raw tree: n landed on the untouched m2, o skipped the hunk level, i entered unchanged children.
test("o expands to the parent, i shrinks to the first changed child, n/p skip siblings with no edit", () => {
  const x = at(nd(0, 1, "before", 2));
  expect(walk(x, "o", 4)).toEqual([
    nd(0, 1, "before", 1),
    nd(0, 1, "before", 0),
    { kind: "hunk", file: 0, fragment: 1 },
    { kind: "file", file: 0 },
  ]);
  expect(walk(at({ kind: "file", file: 0 }), "i", 4)).toEqual([
    { kind: "hunk", file: 0, fragment: 1 },
    nd(0, 1, "before", 0),
    nd(0, 1, "before", 1),
    nd(0, 1, "before", 2),
  ]);
  expect(walk(x, "n", 2)).toEqual([
    nd(0, 1, "before", 3),
    nd(0, 1, "before", 3),
  ]);
  const m1 = at(nd(0, 1, "before", 1));
  expect(press(m1, "n").selections).toEqual([nd(0, 1, "before", 5)]);
  expect(press(m1, "np").selections).toEqual([nd(0, 1, "before", 1)]);
  expect(walk(at({ kind: "hunk", file: 0, fragment: 1 }), "n", 1)).toEqual([
    { kind: "hunk", file: 0, fragment: 4 },
  ]);
});

// j/k stopped twice on an update (once per side) or followed a move into the other file out of order.
test("j/k visit each atom in document order, ]/[ only the unviewed ones", () => {
  const order = [
    nd(0, 1, "before", 2), // u1, its after twin skipped
    nd(0, 1, "before", 3), // d1
    nd(0, 1, "before", 5), // mv, source half
    nd(0, 1, "after", 3), // i1
    nd(0, 4, "after", 0), // i2
    nd(1, 0, "after", 0), // mv, target half
    nd(1, 0, "after", 1), // i3
  ];
  expect(walk(emptyModal, "j", 8)).toEqual([...order, order[6]]);
  expect(walk(at(order[6] as Target), "k", 6)).toEqual(
    order.slice(0, 6).reverse(),
  );
  const seen = ctxWith(["d1", "i1"]);
  expect(walk(at(order[0] as Target), "]", 2, seen)).toEqual([
    order[2],
    order[4],
  ]);
  expect(walk(at(order[4] as Target), "[", 2, seen)).toEqual([
    order[2],
    order[0],
  ]);
});

/** A root and document that hold only what the binding reads, with focus set by hand. */
function fakeRoot() {
  const inside = {
    blur: () => (doc.activeElement = outside),
  } as unknown as Element;
  const outside = {} as Element;
  const doc: { activeElement: Element | null } = { activeElement: outside };
  let listener: ((e: KeyboardEvent) => void) | undefined;
  const root: ModalRoot = {
    addEventListener: (_, l) => (listener = l),
    removeEventListener: () => (listener = undefined),
    contains: (other) => other === inside,
    ownerDocument: doc,
  };
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
    listener?.({ key: k, preventDefault() {}, ...mods } as KeyboardEvent);
  return { root, doc, inside, outside, key };
}

// Keyed per file, a move viewed from b.ts still read unviewed in a.ts, so the reviewer saw the same code twice.
test("v on a move's target half marks its source half in the other file viewed, and toggles back", () => {
  const { root, doc, inside, key } = fakeRoot();
  const store = sessionViewedStore({ device: "d" });
  const modal = bindModal(root, { index, viewed: store });
  doc.activeElement = inside;
  // A click inside m3's body in b.ts selects the innermost changed node there.
  modal.set(
    selectAt(modal.state(), index, {
      file: 1,
      fragment: 0,
      side: "after",
      line: 1,
      column: 4,
    }),
  );
  expect(modal.state().selections).toEqual([nd(1, 0, "after", 0)]);
  key("v");
  const isViewed = atomViewed(store, plainKeyOf);
  expect(viewedOf(index, nd(0, 1, "before", 5), isViewed)).toBe(true);
  expect(viewedOf(index, { kind: "file", file: 1 }, isViewed)).toBe(false);
  key("v");
  expect(viewedOf(index, nd(0, 1, "before", 5), isViewed)).toBe(false);
});

// The listener sat on the page, so j typed into a comment box elsewhere (or Ctrl+J) moved the review selection.
test("keys are ignored while focus is outside the root or a modifier is held", () => {
  const { root, doc, inside, outside, key } = fakeRoot();
  const effects: string[] = [];
  const modal = bindModal(root, {
    index,
    viewed: sessionViewedStore(),
    onEffect: (e) => effects.push(e.kind),
  });
  key("j");
  expect(modal.state().selections).toEqual([]);
  doc.activeElement = inside;
  key("j", { ctrlKey: true });
  expect(modal.state().selections).toEqual([]);
  key("j");
  expect(modal.state().selections).toEqual([nd(0, 1, "before", 2)]);
  key("Escape");
  expect(effects).toEqual(["leave"]);
  expect(doc.activeElement).toBe(outside);
  key("j");
  expect(modal.state().selections).toEqual([nd(0, 1, "before", 2)]);
});

const [u1, d1, mv] = [
  nd(0, 1, "before", 2),
  nd(0, 1, "before", 3),
  nd(0, 1, "before", 5),
];

// Adding from the first selection instead of the primary made J re-add the same stop, and K/N then moved from it.
test("J/K/N add the motion's target from the primary and make it primary; a duplicate only becomes primary", () => {
  expect(press(emptyModal, "J")).toMatchObject({
    selections: [u1],
    primary: 0,
  });
  const three = press(at(u1), "JJ");
  expect(three).toMatchObject({ selections: [u1, d1, mv], primary: 2 });
  expect(press(three, "K")).toMatchObject({
    selections: [u1, d1, mv],
    primary: 1,
  });
  expect(press(at(u1), "N")).toMatchObject({
    selections: [u1, d1],
    primary: 1,
  });
});

// The primary ran past the end of the list, so v and K acted on nothing.
test(") and ( rotate the primary and wrap around both ends", () => {
  const s: ModalState = { ...emptyModal, selections: [u1, d1, mv], primary: 2 };
  expect(press(s, ")").primary).toBe(0);
  expect(press(s, "))").primary).toBe(1);
  expect(press({ ...s, primary: 0 }, "(").primary).toBe(2);
});

// Dropping the primary left an index past the end, or emptied the selections entirely.
test("- drops the primary, the next selection takes over, and the last one stays", () => {
  const s: ModalState = { ...emptyModal, selections: [u1, d1, mv], primary: 1 };
  expect(press(s, "-")).toMatchObject({ selections: [u1, mv], primary: 1 });
  expect(press({ ...s, primary: 2 }, "-")).toMatchObject({
    selections: [u1, d1],
    primary: 0,
  });
  expect(press(at(u1), "-").selections).toEqual([u1]);
});

// Review keys fired inside a comment box, so typing "j" moved the selection instead of writing the letter.
test("a focused field inside the root puts the editor in insert mode, and Escape blurs it back to normal", () => {
  const { root, doc, inside, outside, key } = fakeRoot();
  const field = {
    tagName: "TEXTAREA",
    blur: () => (doc.activeElement = outside),
  } as unknown as Element;
  root.contains = (o) => o === inside || o === field;
  const modal = bindModal(root, { index, viewed: sessionViewedStore() });
  doc.activeElement = field;
  key("j");
  expect(modal.state()).toMatchObject({ mode: "insert", selections: [] });
  key("Escape");
  expect(modal.state().mode).toBe("normal");
  expect(doc.activeElement).toBe(outside);
  doc.activeElement = inside;
  key("j");
  expect(modal.state().selections).toEqual([u1]);
});

// A toolbar button that skipped the binding's effect handling changed the selection but never wrote "viewed".
test("press runs a key through the binding, writing viewed, whatever holds focus", () => {
  const { root } = fakeRoot();
  const store = sessionViewedStore({ device: "d" });
  const modal = bindModal(root, { index, viewed: store });
  modal.set(at(d1));
  expect(modal.press("z")).toBe(false);
  expect(modal.press("v")).toBe(true);
  expect(viewedOf(index, d1, atomViewed(store, plainKeyOf))).toBe(true);
});

const nr = (node: number) =>
  ({ file: 0, fragment: 1, side: "before", node }) as const;

// A score on a hunk or file selection would land on no node, or `s 2` would score only the primary.
test("s 2 scores every node selection and skips hunks", () => {
  const hunk: Target = { kind: "hunk", file: 0, fragment: 1 };
  const s = press({ ...emptyModal, selections: [u1, hunk, mv] }, "s");
  expect(s.pending).toBe("s");
  const t = modalKey(s, "2", ctxWith());
  expect(t?.state).toEqual({ ...emptyModal, selections: [u1, hunk, mv] });
  expect(t?.effects).toEqual([
    { kind: "setScore", nodes: [nr(2), nr(5)], score: 2 },
  ]);
});

// A prefix that stayed pending turned the next motion into a score, or let the stray key move the selection.
test("a key that is not a score key after s cancels the prefix and does nothing else", () => {
  expect(modalKey(press(at(u1), "s"), "j", ctxWith())).toEqual({
    state: at(u1),
    effects: [],
  });
});

// Keyed by file/fragment/node index, a score moved to another node (or vanished) once a redraw reindexed files.
test("a score is keyed by the node itself, so it survives a rebind onto reindexed files", () => {
  const { root } = fakeRoot();
  const scores = sessionScoreStore({ device: "d" });
  const viewed = sessionViewedStore();
  const modal = bindModal(root, { index, viewed, scores });
  modal.set(at(mv));
  modal.press("s");
  modal.press("q");
  modal.dispose();
  const shifted = atomIndex([{ path: "0.ts", fragments: [] }, ...files]);
  const scoreOf = nodeScore(shifted, scores, plainKeyOf);
  expect(scoreOf({ ...nr(5), file: 1 })).toBe(-1);
  expect(scoreOf({ ...nr(2), file: 1 })).toBe(null);
});

// The user's rule "점수를 매기지 않고 viewed 처리도 가능하게": viewed must never need, write or clear a score.
test("v marks a node viewed while its score stays unset", () => {
  const { root } = fakeRoot();
  const viewed = sessionViewedStore({ device: "d" });
  const scores = sessionScoreStore({ device: "d" });
  const modal = bindModal(root, { index, viewed, scores });
  modal.set(at(d1));
  modal.press("v");
  expect(viewedOf(index, d1, atomViewed(viewed, plainKeyOf))).toBe(true);
  expect(nodeScore(index, scores, plainKeyOf)(nr(3))).toBe(null);
  expect(scores.state()).toEqual({});
});
