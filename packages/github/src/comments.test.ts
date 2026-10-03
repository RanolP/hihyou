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

/**
 * A fake api.github.com: the compare page with `patch`, and GraphQL answered per operation, every request kept.
 * The first `threadFails` calls to `addPullRequestReviewThread` answer with no thread, as GitHub does for a line
 * outside the pull request's diff.
 */
function fakeGitHub(pending: string | undefined, threadFails = 0) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  let threadCalls = 0;
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
    if (op === "addPullRequestReviewThread")
      return Response.json({
        data: {
          addPullRequestReviewThread: {
            thread:
              ++threadCalls <= threadFails ? null : { id: `T${calls.length}` },
          },
        },
      });
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
      submitPullRequestReview: {
        submitPullRequestReview: { pullRequestReview: { id: "R1" } },
      },
      deletePullRequestReview: {
        deletePullRequestReview: {
          pullRequestReview: { id: variables["review"] },
        },
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

// A single comment whose thread lands outside the diff left behind an empty PENDING review that stranded every
// later comment with "a review is started", though the user never started one.
test("a single comment deletes the review it started when addThread makes no thread, so the next comment can still post", async () => {
  const { client, target, calls } = fakeGitHub(undefined, 1);
  const store = githubCommentStore(client, target, lines);

  await expect(store.comment(anchor, "outside the diff")).rejects.toThrow(
    /GitHub made no thread/,
  );
  expect(calls.map((c) => c.op)).toEqual([
    "pull",
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "deletePullRequestReview",
  ]);
  expect(calls.at(-1)?.variables).toEqual({ review: "R1" });
  expect(store.reviewing()).toBe(false);

  await store.comment(anchor, "inside the diff");
  expect(calls.map((c) => c.op)).toEqual([
    "pull",
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "deletePullRequestReview",
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "submitPullRequestReview",
  ]);
  expect(store.reviewing()).toBe(false);
  expect(store.all()).toMatchObject([{ body: "inside the diff" }]);
});

// A review submitted with a -2 or an all-+2 score reached GitHub as COMMENT, so it neither blocked nor approved.
test("a submitted review carries its own event to GitHub, not COMMENT", async () => {
  for (const event of ["APPROVE", "REQUEST_CHANGES"] as const) {
    const { client, target, calls } = fakeGitHub("R0");
    const store = githubCommentStore(client, target, lines);
    await store.review(anchor, "one");
    await store.submitReview(event);
    expect(calls.at(-1)).toEqual({
      op: "submitPullRequestReview",
      variables: { review: "R0", event },
    });
  }
});
