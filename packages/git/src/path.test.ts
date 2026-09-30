import { expect, test } from "vitest";
import { dirname, join, resolve } from "./path.js";

// Catches join's fast path handing back a `..`, `.` or doubled slash unresolved, which would make a
// linked worktree's `commondir` (`../..`) or a `gitdir:` file point at a path no file system finds.
test("join and resolve normalize whatever the fast path cannot pass through", () => {
  expect(join("/r", "a/b.txt")).toBe("/r/a/b.txt");
  expect(join("/r/.git/worktrees/x", "../..")).toBe("/r/.git");
  expect(join("/r/", "./a", "b/")).toBe("/r/a/b");
  expect(join("/r", ".hidden/..x")).toBe("/r/.hidden/..x");
  expect(join("C:/r", "..", "..")).toBe("C:/");
  expect(resolve("/r/sub", "/abs/./p")).toBe("/abs/p");
  expect(dirname("/r")).toBe("/");
  expect(dirname("C:/r/a")).toBe("C:/r");
});
