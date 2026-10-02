import { expect, test } from "vitest";
import { pullFilesPage } from "./page.js";

// The toggle must appear on both URLs GitHub serves the Files changed tab under, and on no other PR tab, where
// hiding the "diff area" would hide the conversation instead.
test("only a pull request's Files changed tab is a page to mount on", () => {
  const pull = { owner: "vitejs", repo: "vite", pull: 21626 };
  expect(
    pullFilesPage("https://github.com/vitejs/vite/pull/21626/files"),
  ).toEqual(pull);
  expect(
    pullFilesPage("https://github.com/vitejs/vite/pull/21626/changes"),
  ).toEqual(pull);
  expect(
    pullFilesPage(
      "https://github.com/vitejs/vite/pull/21626/files/0f3f23b8?diff=split#r1",
    ),
  ).toEqual(pull);
  expect(
    pullFilesPage("https://github.com/vitejs/vite/pull/21626"),
  ).toBeUndefined();
  expect(
    pullFilesPage("https://github.com/vitejs/vite/pull/21626/commits"),
  ).toBeUndefined();
  expect(
    pullFilesPage("https://github.com/vitejs/vite/pull/21626/filesystem"),
  ).toBeUndefined();
});
