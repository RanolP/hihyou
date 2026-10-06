import { expect, test } from "vitest";
import { lowerComment, readLowered, validKey } from "./lowered.js";

const key = {
  anchor: {
    side: "before" as const,
    path: "src/a-->b.ts",
    nodes: [[0, 3]],
    chars: { start: 2, end: 5 },
  },
  before: "b".repeat(40),
  after: null,
  score: -2 as const,
};

// A key hihyou cannot read back loses every anchor it posted; a path holding "-->" would close the comment early.
test("a lowered comment reads back to its body with the verdict and to its key", () => {
  const posted = lowerComment("see <details> here\n\n-->", key);
  expect(posted.startsWith("-2: must not merge\n\nsee <details> here")).toBe(
    true,
  );
  expect(posted.split("\n").at(-1)?.match(/-->/g)).toHaveLength(1);
  expect(readLowered(posted)).toEqual({
    body: "-2: must not merge\n\nsee <details> here\n\n-->",
    key,
  });
});

// The key is untrusted input: one that fails validation must leave the comment exactly as posted, never half-read.
test("a malformed key is ignored and the body stays as posted", () => {
  const good = JSON.parse(
    /<!-- hihyou (.*) -->/.exec(lowerComment("x", key))?.[1] ?? "",
  ) as Record<string, unknown>;
  expect(validKey(good)).toEqual(key);
  const bad: unknown[] = [
    { ...good, score: 0 },
    { ...good, before: "not-a-sha" },
    { ...good, before: null, after: null },
    { ...good, anchor: { ...key.anchor, nodes: [] } },
    { ...good, anchor: { ...key.anchor, nodes: [[-1]] } },
    { ...good, anchor: { ...key.anchor, nodes: [[0], [1]] } },
    { ...good, anchor: { ...key.anchor, side: "left" } },
  ];
  for (const raw of bad) expect(validKey(raw)).toBeUndefined();
  for (const posted of [
    "x\n\n<!-- hihyou {not json} -->",
    `x\n\n<!-- hihyou ${JSON.stringify({ ...good, score: 3 })} -->`,
  ])
    expect(readLowered(posted)).toEqual({ body: posted });
  // Who judged comes from the host's author only; the key carries no author field to read.
  expect(validKey({ ...good, author: "mallory" })).not.toHaveProperty("author");
});
