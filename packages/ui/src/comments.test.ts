import { expect, test } from "vitest";
import { atomIndex, contextFragment, type NodeOutline } from "./atoms.js";
import {
  anchorOf,
  displayRange,
  refOf,
  sessionCommentStore,
} from "./comments.js";
import {
  emptyModal,
  type ModalContext,
  type ModalState,
  modalKey,
  narrowAt,
  selectAt,
} from "./modal.js";
import type { DiffFile } from "./rows.js";

const node = (
  steps: number[],
  parent: number,
  from: number,
  to: number,
): NodeOutline => ({
  steps,
  parent,
  kind: "node",
  start: { line: 0, column: from },
  end: { line: 0, column: to },
  changed: false,
  hash: "",
});

/** One unchanged line of context: `let fooBar = baz(qux);`, with the call `baz(qux)` inside the declaration. */
const files: DiffFile[] = [
  {
    path: "a.ts",
    fragments: [
      {
        kind: "unchanged",
        spans: [{ text: "let fooBar = baz(qux);" }],
        at: [],
        lines: { before: 1, after: 1 },
        nodes: [node([0], -1, 0, 22), node([0, 1], 0, 13, 21)],
      },
    ],
  },
];
const index = atomIndex(files);
const ctx: ModalContext = { index, isViewed: () => false };
const point = (column: number) => ({
  file: 0,
  fragment: contextFragment,
  side: "after" as const,
  line: 0,
  column,
});
const press = (s: ModalState, key: string) => modalKey(s, key, ctx);

// Context lines had no outline, so code outside a hunk, revealed or not, could be neither selected nor commented on.
test("a node in unchanged context is selected, narrowed word by word, and commented on with that range", () => {
  let s = selectAt(emptyModal, index, point(14));
  expect(s.selections[0]).toMatchObject({ fragment: contextFragment, node: 1 });
  s = press(s, "w")?.state ?? s;
  expect(s.chars).toEqual({ start: 0, end: 3 }); // baz
  s = press(s, "w")?.state ?? s;
  // "(" counts, whitespace would not: qux is the 5th to 7th character.
  expect(s.chars).toEqual({ start: 4, end: 7 });
  const t = press(s, "c");
  expect(t?.effects).toEqual([
    {
      kind: "comment",
      at: { file: 0, fragment: contextFragment, side: "after", node: 1 },
      chars: { start: 4, end: 7 },
    },
  ]);
  const at = {
    file: 0,
    fragment: contextFragment,
    side: "after" as const,
    node: 1,
  };
  const anchor = anchorOf(index, at, s.chars);
  expect(anchor).toEqual({
    side: "after",
    path: "a.ts",
    nodes: [[0, 1]],
    chars: { start: 4, end: 7 },
  });
  expect(anchor && refOf(index, anchor)?.node).toBe(1);
  // Moving the selection drops the narrowing, so the next comment is not on a stale word of another node.
  expect((press(s, "o")?.state ?? s).chars).toBeUndefined();
});

// A range stored as display offsets drifted onto other text once the node was reformatted.
test("a narrowed range finds the same word in the node reformatted", () => {
  const s = narrowAt(emptyModal, index, point(17), point(20));
  expect(s.chars).toEqual({ start: 4, end: 7 });
  const reformatted = "baz(\n  qux\n)";
  const r = displayRange(reformatted, { start: 4, end: 7 });
  expect(reformatted.slice(r.start, r.end)).toBe("qux");
});

// A comment written into a started review must wait for the submit, as on GitHub, while a single comment is final at once.
test("review comments stay pending until the review is submitted; a single comment is final at once", async () => {
  const store = sessionCommentStore();
  const anchor = { side: "after" as const, path: "a.ts", nodes: [[0]] };
  await store.comment(anchor, "single");
  expect(store.reviewing()).toBe(false);
  await store.review(anchor, "first");
  await store.review(anchor, "second");
  expect(store.reviewing()).toBe(true);
  expect(store.all().map((n) => [n.body, n.pending])).toEqual([
    ["single", false],
    ["first", true],
    ["second", true],
  ]);
  await store.submitReview("COMMENT");
  expect(store.reviewing()).toBe(false);
  expect(store.all().every((n) => !n.pending)).toBe(true);
});

// A reply is the same choice as a comment: "Add single reply" is final at once, one into the review waits for the submit.
test("a single reply is final at once and a review reply stays pending, both on the thread's anchor", async () => {
  const store = sessionCommentStore();
  const anchor = { side: "after" as const, path: "a.ts", nodes: [[0]] };
  await store.comment(anchor, "thread");
  const thread = store.all()[0]?.id ?? "";
  await store.reply(thread, "single reply");
  expect(store.reviewing()).toBe(false);
  await store.reviewReply(thread, "review reply");
  expect(store.reviewing()).toBe(true);
  expect(store.all().slice(1)).toMatchObject([
    { body: "single reply", pending: false, thread, anchor },
    { body: "review reply", pending: true, thread, anchor },
  ]);
  await store.submitReview("COMMENT");
  expect(store.all().every((n) => !n.pending)).toBe(true);
});

// A thread read from GitHub names the node on its lines, which the view may not draw (inside an unchanged
// statement); exact matching dropped such a thread from the view, so `r` could not answer it either.
test("an anchor on a node the view does not draw is drawn at its nearest drawn ancestor, and one on no file node is not", () => {
  const on = (nodes: number[][]) => ({
    side: "after" as const,
    path: "a.ts",
    nodes,
  });
  expect(refOf(index, on([[0, 1, 0]]))?.node).toBe(1);
  expect(refOf(index, on([[0, 0]]))?.node).toBe(0);
  expect(refOf(index, on([[3]]))).toBeUndefined();
});
