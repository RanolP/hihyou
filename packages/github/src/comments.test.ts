import { expect, test } from "vitest";
import { createGitHubClient } from "./client.js";
import { githubCommentStore, hunkLines, placeOf } from "./comments.js";

const anchor = { side: "after" as const, path: "src/a.ts", nodes: [[0]] };
const patch = "@@ -1,3 +1,4 @@\n a\n+b\n c\n d\n@@ -20,2 +21,6 @@\n x\n+y";

// GitHub rejects a comment on a line outside its diff's hunks, so a whole function reaching past its hunk, or a
// context node revealed from an elided run, would fail to post at all.
test("a node past its hunk is clamped to the hunk, and a node outside every hunk becomes a file comment", () => {
  const hunks = hunkLines(patch);
  expect(hunks.after).toEqual([
    { start: 1, end: 4 },
    { start: 21, end: 26 },
  ]);
  expect(placeOf("src/a.ts", anchor, [{ start: 2, end: 3 }], hunks)).toEqual({
    path: "src/a.ts",
    subjectType: "LINE",
    side: "RIGHT",
    line: 3,
    startLine: 2,
    startSide: "RIGHT",
  });
  expect(placeOf("src/a.ts", anchor, [{ start: 18, end: 30 }], hunks)).toEqual({
    path: "src/a.ts",
    subjectType: "LINE",
    side: "RIGHT",
    line: 26,
    startLine: 21,
    startSide: "RIGHT",
    prefix: "Lines 18-30 (after):\n\n",
  });
  expect(placeOf("src/a.ts", anchor, [{ start: 10, end: 10 }], hunks)).toEqual({
    path: "src/a.ts",
    subjectType: "FILE",
    prefix: "Line 10 (after):\n\n",
  });
});

/** A fake api.github.com: the compare page with `patch`, and GraphQL answered per operation, every request kept. */
function fakeGitHub(pending: string | undefined) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/compare/"))
      return Response.json({
        merge_base_commit: { sha: "base" },
        files: [{ sha: "s", filename: "src/a.ts", status: "modified", patch }],
      });
    const { query, variables } = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const op = /(\w+)\s*\(input/.exec(query)?.[1] ?? "pull";
    calls.push({ op, variables });
    const data: Record<string, unknown> = {
      pull: {
        repository: {
          pullRequest: {
            id: "PR",
            reviews: { nodes: pending ? [{ id: pending }] : [] },
          },
        },
      },
      addPullRequestReview: {
        addPullRequestReview: { pullRequestReview: { id: "R1" } },
      },
      addPullRequestReviewThread: {
        addPullRequestReviewThread: { thread: { id: `T${calls.length}` } },
      },
      submitPullRequestReview: {
        submitPullRequestReview: { pullRequestReview: { id: "R1" } },
      },
    };
    return Response.json({ data: data[op] });
  };
  const client = createGitHubClient({
    token: "t",
    fetch: fetch as typeof globalThis.fetch,
  });
  const target = { owner: "o", repo: "r", number: 7, base: "b", head: "HEAD" };
  return { client, target, calls };
}
const lines = async () => [{ start: 2, end: 2 }];

// "Add single comment" on GitHub is a review submitted at once; left pending, it would show to nobody but its author.
test("a single comment is posted as a review submitted at once with COMMENT", async () => {
  const { client, target, calls } = fakeGitHub(undefined);
  const store = githubCommentStore(client, target, lines);
  await store.comment(anchor, "hi");
  expect(calls.map((c) => c.op)).toEqual([
    "pull",
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "submitPullRequestReview",
  ]);
  expect(calls[1]?.variables).toEqual({ pr: "PR", commit: "HEAD" });
  expect(calls[2]?.variables["input"]).toEqual({
    pullRequestReviewId: "R1",
    body: "hi",
    path: "src/a.ts",
    subjectType: "LINE",
    side: "RIGHT",
    line: 2,
  });
  expect(calls[3]?.variables).toEqual({ review: "R1", event: "COMMENT" });
  expect(store.all()).toMatchObject([{ body: "hi", pending: false }]);
  expect(store.reviewing()).toBe(false);
});

// GitHub allows one pending review per reviewer, so starting a second beside one begun on github.com would fail.
test("review comments join the pending review already on GitHub and stay pending until submitted", async () => {
  const { client, target, calls } = fakeGitHub("R0");
  const store = githubCommentStore(client, target, lines);
  await store.review(anchor, "one");
  await store.review(anchor, "two");
  expect(store.reviewing()).toBe(true);
  expect(store.all().map((n) => n.pending)).toEqual([true, true]);
  await expect(store.comment(anchor, "single")).rejects.toThrow(
    /review is started/,
  );
  await store.submitReview("COMMENT");
  expect(calls.map((c) => c.op)).toEqual([
    "pull",
    "addPullRequestReviewThread",
    "addPullRequestReviewThread",
    "submitPullRequestReview",
  ]);
  expect(calls[1]?.variables["input"]).toMatchObject({
    pullRequestReviewId: "R0",
  });
  expect(store.all().map((n) => n.pending)).toEqual([false, false]);
  expect(store.reviewing()).toBe(false);
});
