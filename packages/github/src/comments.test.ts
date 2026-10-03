import { expect, test, vi } from "vitest";
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
 * outside the pull request's diff. Its one pending review is shared state, as GitHub's is for every tab of one reviewer.
 */
function fakeGitHub(initial: string | undefined, threadFails = 0) {
  let pending = initial;
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
    if (op === "addPullRequestReview") {
      if (pending !== undefined)
        return Response.json({
          errors: [{ message: "one pending review per pull request" }],
        });
      pending = "R1";
    }
    if (op === "submitPullRequestReview" || op === "deletePullRequestReview") {
      if (variables["review"] !== pending)
        return Response.json({
          errors: [{ message: "the review is not pending" }],
        });
      pending = undefined;
    }
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
      // A reply whose body is "no reply" answers with no comment, as a failed write would.
      addPullRequestReviewThreadReply: {
        addPullRequestReviewThreadReply: {
          comment:
            (variables["input"] as { body?: string } | undefined)?.body ===
            "no reply"
              ? null
              : { id: `C${calls.length}` },
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
/** The writes, without the pending-review reads every write starts with. */
const writes = <C extends { op: string }>(calls: C[]) =>
  calls.filter((c) => c.op !== "pull");

// "Add single comment" on GitHub is a review submitted at once; left pending, it would show to nobody but its author.
test("a single comment is posted as a review submitted at once with COMMENT", async () => {
  const { client, target, calls } = fakeGitHub(undefined);
  const store = githubCommentStore(client, target, lines);
  await store.comment(anchor, "hi");
  expect(writes(calls).map((c) => c.op)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "submitPullRequestReview",
  ]);
  expect(writes(calls)[0]?.variables).toEqual({ pr: "PR", commit: "HEAD" });
  expect(writes(calls)[1]?.variables["input"]).toEqual({
    pullRequestReviewId: "R1",
    body: "hi",
    path: "src/a.ts",
    subjectType: "LINE",
    side: "RIGHT",
    line: 2,
  });
  expect(writes(calls)[2]?.variables).toEqual({
    review: "R1",
    event: "COMMENT",
  });
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
  expect(writes(calls).map((c) => c.op)).toEqual([
    "addPullRequestReviewThread",
    "addPullRequestReviewThread",
    "submitPullRequestReview",
  ]);
  expect(writes(calls)[0]?.variables["input"]).toMatchObject({
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
  expect(writes(calls).map((c) => c.op)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "deletePullRequestReview",
  ]);
  expect(calls.at(-1)?.variables).toEqual({ review: "R1" });
  expect(store.reviewing()).toBe(false);

  await store.comment(anchor, "inside the diff");
  expect(writes(calls).map((c) => c.op)).toEqual([
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

/** The ops sent, without the pull request reads around them. */
const opsOf = (calls: { op: string }[]) =>
  calls.map((c) => c.op).filter((op) => op !== "pull");

// "Add single reply" left in a pending review would show to nobody but its author; a review reply submitted at once
// would publish before the rest of the review.
test("a single reply is a review submitted at once, and a review reply joins the pending review on the thread's id", async () => {
  const { client, target, calls } = fakeGitHub(undefined);
  const store = githubCommentStore(client, target, lines);
  await store.comment(anchor, "thread");
  const thread = store.all()[0]?.id ?? "";
  calls.length = 0;

  await store.reply(thread, "single");
  expect(opsOf(calls)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThreadReply",
    "submitPullRequestReview",
  ]);
  expect(
    calls.find((c) => c.op === "addPullRequestReviewThreadReply")?.variables,
  ).toEqual({
    input: {
      pullRequestReviewId: "R1",
      pullRequestReviewThreadId: thread,
      body: "single",
    },
  });
  expect(calls.at(-1)?.variables).toEqual({ review: "R1", event: "COMMENT" });
  expect(store.reviewing()).toBe(false);
  calls.length = 0;

  await store.reviewReply(thread, "pending");
  expect(opsOf(calls)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThreadReply",
  ]);
  expect(store.reviewing()).toBe(true);
  expect(store.all().slice(1)).toMatchObject([
    { body: "single", pending: false, thread, anchor },
    { body: "pending", pending: true, thread, anchor },
  ]);
});

// A failed single reply would leave the review it started PENDING on GitHub, stranding every later single comment
// or reply with "a review is started", as 748e85d fixed for comments.
test("a single reply deletes the review it started when GitHub makes no reply, so the next reply can still post", async () => {
  const { client, target, calls } = fakeGitHub(undefined);
  const store = githubCommentStore(client, target, lines);
  await store.comment(anchor, "thread");
  const thread = store.all()[0]?.id ?? "";
  calls.length = 0;

  await expect(store.reply(thread, "no reply")).rejects.toThrow(
    /GitHub made no reply/,
  );
  expect(opsOf(calls)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThreadReply",
    "deletePullRequestReview",
  ]);
  expect(calls.at(-1)?.variables).toEqual({ review: "R1" });
  expect(store.reviewing()).toBe(false);

  await store.reply(thread, "second try");
  expect(store.reviewing()).toBe(false);
  expect(store.all().slice(1)).toMatchObject([
    { body: "second try", pending: false, thread },
  ]);
});

/** Two views of one pull request, as two tabs or a tab and a VS Code panel hold them, each listening as a view does. */
function twoTabs(pending: string | undefined) {
  const github = fakeGitHub(pending);
  const a = githubCommentStore(github.client, github.target, lines);
  const b = githubCommentStore(github.client, github.target, lines);
  const stop = [a.subscribe(() => {}), b.subscribe(() => {})];
  return { ...github, a, b, close: () => stop.forEach((s) => s()) };
}

// A tab kept the pending review it had read once, so after another tab submitted it, its own "Submit review" sent
// a second submit to a review that was no longer pending, and GitHub refused it.
test("a review submitted in another tab is read back, and this tab's submit then sends nothing", async () => {
  const { a, b, calls, close } = twoTabs(undefined);
  await b.review(anchor, "from b");
  await a.refresh();
  expect(a.reviewing()).toBe(true);
  await a.submitReview("APPROVE");

  await b.submitReview("COMMENT");
  expect(writes(calls).map((c) => c.op)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "submitPullRequestReview",
  ]);
  expect(b.reviewing()).toBe(false);
  expect(b.all()).toMatchObject([{ body: "from b", pending: false }]);
  close();
});

// A tab that never saw another tab's new pending review offered "Add single comment", whose own new review GitHub
// refuses beside the pending one.
test("a review started in another tab is read back before a single comment, which then asks to join it", async () => {
  const { a, b, calls, close } = twoTabs(undefined);
  await a.refresh();
  await b.review(anchor, "from b");
  await expect(a.comment(anchor, "single")).rejects.toThrow(
    /review is started/,
  );
  expect(a.reviewing()).toBe(true);
  expect(writes(calls).map((c) => c.op)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThread",
  ]);
  close();
});

// Without the nudge, the other tab kept showing the old state until it next regained focus.
test("a change written in one tab makes the other re-read GitHub at once", async () => {
  const { a, b, close } = twoTabs(undefined);
  const heard = vi.fn();
  const stop = a.subscribe(heard);
  await a.refresh();
  await b.review(anchor, "from b");
  await vi.waitFor(() => expect(a.reviewing()).toBe(true));
  expect(heard).toHaveBeenCalled();
  stop();
  close();
});
