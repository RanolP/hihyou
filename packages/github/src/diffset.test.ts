import { expect, test } from "vitest";
import { encodeBlobId } from "./blob.js";
import { createGitHubClient } from "./client.js";
import {
  compareFilesPerPage,
  maxCompareFiles,
  resolveGitHubDiffset,
} from "./diffset.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function comparePath(url: string): boolean {
  return url.includes("/compare/base...head");
}

// If the loop kept fetching whenever a page is exactly full, or stopped a page early, a large PR's diff
// would silently drop files or hang; this pins the "page.length < per_page" stop rule against a real
// full-then-partial pair of pages.
test("pagination stops when a compare page comes back shorter than per_page", async () => {
  let calls = 0;
  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      const u = String(url);
      expect(comparePath(u)).toBe(true);
      calls++;
      const page = Number(new URL(u).searchParams.get("page"));
      if (page === 1) {
        const files = Array.from({ length: compareFilesPerPage }, (_, i) => ({
          sha: `after-${i}`,
          filename: `file-1-${i}.txt`,
          status: "added",
        }));
        return jsonResponse({ merge_base_commit: { sha: "base-tree" }, files });
      }
      if (page === 2) {
        return jsonResponse({
          merge_base_commit: { sha: "base-tree" },
          files: [
            { sha: "after-last", filename: "file-2-0.txt", status: "added" },
          ],
        });
      }
      throw new Error(`unexpected page ${page}`);
    },
  });

  const resolution = await resolveGitHubDiffset(client, {
    owner: "o",
    repo: "r",
    base: "base",
    head: "head",
  });

  expect(calls).toBe(2); // a third call would mean the stop condition never fired
  expect(resolution.changes).toHaveLength(compareFilesPerPage + 1);
  expect(resolution.changes.at(-1)).toEqual({
    path: "file-2-0.txt",
    before: null,
    after: encodeBlobId("o", "r", "after-last"),
  });
});

// GitHub hard-caps a single compare at 3000 files; silently truncating a diff there would be worse than
// refusing, since a reviewer would think they saw the whole change.
test("surfaces GitHub's 3000-file compare cap as an error instead of a silently truncated diff", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async () => {
      const files = Array.from({ length: compareFilesPerPage }, (_, i) => ({
        sha: `s-${i}`,
        filename: `f-${i}.txt`,
        status: "added",
      }));
      return jsonResponse({ merge_base_commit: { sha: "base-tree" }, files });
    },
  });

  await expect(
    resolveGitHubDiffset(client, {
      owner: "o",
      repo: "r",
      base: "base",
      head: "head",
    }),
  ).rejects.toThrow(new RegExp(`caps a diff at ${maxCompareFiles} files`));
});

// A renamed file's `sha` is the after (head) blob; the before blob only exists under its old path, in
// the merge-base tree compare already computed against. Losing either side breaks the rename's diff.
test("a renamed file maps oldPath and its before-SHA from the merge-base tree", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      const u = String(url);
      if (comparePath(u)) {
        return jsonResponse({
          merge_base_commit: { sha: "merge-base-sha" },
          files: [
            {
              sha: "after-sha",
              filename: "src/new.ts",
              previous_filename: "src/old.ts",
              status: "renamed",
            },
          ],
        });
      }
      if (u.includes("/git/trees/merge-base-sha")) {
        return jsonResponse({
          truncated: false,
          tree: [{ path: "src/old.ts", type: "blob", sha: "before-sha" }],
        });
      }
      throw new Error(`unexpected request ${u}`);
    },
  });

  const resolution = await resolveGitHubDiffset(client, {
    owner: "o",
    repo: "r",
    base: "base",
    head: "head",
  });

  expect(resolution.changes).toEqual([
    {
      path: "src/new.ts",
      oldPath: "src/old.ts",
      before: encodeBlobId("o", "r", "before-sha"),
      after: encodeBlobId("o", "r", "after-sha"),
    },
  ]);
});

// A truncated merge-base tree (very large repos) must not silently drop before-side blobs; the fallback
// is one `contents` lookup per path actually needed, not a failure.
test("falls back to a per-path contents lookup when the merge-base tree is truncated", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      const u = String(url);
      if (comparePath(u)) {
        return jsonResponse({
          merge_base_commit: { sha: "merge-base-sha" },
          files: [
            { sha: "after-sha", filename: "deep/file.ts", status: "modified" },
          ],
        });
      }
      if (u.includes("/git/trees/merge-base-sha")) {
        return jsonResponse({ truncated: true, tree: [] });
      }
      if (u.includes("/contents/deep/file.ts")) {
        expect(new URL(u).searchParams.get("ref")).toBe("merge-base-sha");
        return jsonResponse({ sha: "before-sha-from-contents" });
      }
      throw new Error(`unexpected request ${u}`);
    },
  });

  const resolution = await resolveGitHubDiffset(client, {
    owner: "o",
    repo: "r",
    base: "base",
    head: "head",
  });

  expect(resolution.changes).toEqual([
    {
      path: "deep/file.ts",
      before: encodeBlobId("o", "r", "before-sha-from-contents"),
      after: encodeBlobId("o", "r", "after-sha"),
    },
  ]);
});

// A removed file has no after blob; GitHub reports the base-side blob directly in `sha` for it, which
// must NOT go through the merge-base tree lookup (there is nothing to look up an "after" for).
test("a removed file uses its own sha as the before blob, with no after", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      const u = String(url);
      if (comparePath(u)) {
        return jsonResponse({
          merge_base_commit: { sha: "merge-base-sha" },
          files: [
            { sha: "removed-sha", filename: "gone.ts", status: "removed" },
          ],
        });
      }
      throw new Error(`unexpected request ${u}`); // the tree must never be fetched for this case
    },
  });

  const resolution = await resolveGitHubDiffset(client, {
    owner: "o",
    repo: "r",
    base: "base",
    head: "head",
  });

  expect(resolution.changes).toEqual([
    {
      path: "gone.ts",
      before: encodeBlobId("o", "r", "removed-sha"),
      after: null,
    },
  ]);
});
