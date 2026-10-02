import { describe, expect, it } from "vitest";
import { parsePullRef, remotesFor } from "./pull-ref.js";

describe("parsePullRef", () => {
  // A pasted link from any PR tab must open that PR, or the debug command fails on the commonest input.
  it("reads a pull request URL, with or without a tab suffix", () => {
    const want = { owner: "vitejs", repo: "vite", number: 123 };
    expect(parsePullRef("https://github.com/vitejs/vite/pull/123")).toEqual(
      want,
    );
    expect(
      parsePullRef("https://github.com/vitejs/vite/pull/123/files"),
    ).toEqual(want);
    expect(
      parsePullRef("https://github.com/vitejs/vite/pull/123/commits/0123abcd"),
    ).toEqual(want);
  });

  it("reads owner/repo#n and a bare number", () => {
    expect(parsePullRef(" facebook/react.dev#9 ")).toEqual({
      owner: "facebook",
      repo: "react.dev",
      number: 9,
    });
    expect(parsePullRef("#42")).toEqual({ number: 42 });
    expect(parsePullRef("42")).toEqual({ number: 42 });
  });

  // An issue URL or junk must be rejected inline rather than resolved as some other pull request.
  it("rejects anything else", () => {
    expect(
      parsePullRef("https://github.com/vitejs/vite/issues/123"),
    ).toBeUndefined();
    expect(parsePullRef("vite#0")).toBeUndefined();
  });
});

describe("remotesFor", () => {
  const remotes = [
    { owner: "vitejs", repo: "vite" },
    { owner: "RanolP", repo: "hihyou" },
  ];

  // A URL typed in another case than the git remote must still select it, as github.com treats both as one repository.
  it("matches the named remote ignoring case, and every remote for a bare number", () => {
    expect(
      remotesFor({ owner: "ranolp", repo: "HIHYOU", number: 1 }, remotes),
    ).toEqual([remotes[1]]);
    expect(
      remotesFor({ owner: "facebook", repo: "react", number: 1 }, remotes),
    ).toEqual([]);
    expect(remotesFor({ number: 1 }, remotes)).toEqual(remotes);
  });
});
