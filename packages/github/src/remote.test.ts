import { expect, test } from "vitest";
import { parseGitHubRemote } from "./remote.js";

// The three remote forms git and GitHub tooling actually hand out; a missed form breaks "open from clipboard".
test("parses https, ssh-shorthand and explicit-ssh github.com remotes, with or without .git", () => {
  const expected = { owner: "RanolP", repo: "hihyou" };
  expect(parseGitHubRemote("https://github.com/RanolP/hihyou")).toEqual(
    expected,
  );
  expect(parseGitHubRemote("https://github.com/RanolP/hihyou.git")).toEqual(
    expected,
  );
  expect(parseGitHubRemote("git@github.com:RanolP/hihyou")).toEqual(expected);
  expect(parseGitHubRemote("git@github.com:RanolP/hihyou.git")).toEqual(
    expected,
  );
  expect(parseGitHubRemote("ssh://git@github.com/RanolP/hihyou")).toEqual(
    expected,
  );
  expect(parseGitHubRemote("ssh://git@github.com/RanolP/hihyou.git")).toEqual(
    expected,
  );
});

test("rejects a non-github.com host so an Enterprise remote is not silently misparsed", () => {
  expect(parseGitHubRemote("https://gitlab.com/RanolP/hihyou")).toBeUndefined();
  expect(
    parseGitHubRemote("https://github.example.com/RanolP/hihyou"),
  ).toBeUndefined();
  expect(parseGitHubRemote("not a url")).toBeUndefined();
});
