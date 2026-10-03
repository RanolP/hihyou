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
 * outside the pull request's diff. Its one pending review and its review threads are shared state, as GitHub's are
 * for every tab of one reviewer; `threads` may be seeded, or pushed to as another reviewer would.
 */
function fakeGitHub(
  initial: string | undefined,
  threadFails = 0,
  threads: FakeThread[] = [],
) {
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
    const input = variables["input"] as Record<string, unknown> | undefined;
    const by = (review: unknown, body: unknown, id: string): FakeComment => ({
      id,
      body: String(body),
      state: "PENDING",
      author: { login: "me" },
      review: String(review),
    });
    if (op === "submitPullRequestReview")
      for (const t of threads)
        for (const c of t.comments.nodes)
          if (c.review === variables["review"]) {
            // A submitted comment leaves its review, which a later delete of a review reusing the id cannot touch.
            c.state = "SUBMITTED";
            delete c.review;
          }
    if (op === "deletePullRequestReview")
      for (const t of threads.splice(0))
        if (
          (t.comments.nodes = t.comments.nodes.filter(
            (c) => c.review !== variables["review"],
          )).length > 0
        )
          threads.push(t);
    if (op === "addPullRequestReviewThread") {
      if (++threadCalls <= threadFails)
        return Response.json({
          data: { addPullRequestReviewThread: { thread: null } },
        });
      const id = `T${calls.length}`;
      threads.push({
        id,
        path: String(input?.["path"]),
        diffSide: input?.["side"] === "LEFT" ? "LEFT" : "RIGHT",
        line: (input?.["line"] as number | undefined) ?? null,
        startLine: (input?.["startLine"] as number | undefined) ?? null,
        isOutdated: false,
        subjectType: input?.["subjectType"] === "FILE" ? "FILE" : "LINE",
        comments: {
          nodes: [
            by(
              input?.["pullRequestReviewId"],
              input?.["body"],
              `C${calls.length}`,
            ),
          ],
        },
      });
      return Response.json({
        data: { addPullRequestReviewThread: { thread: { id } } },
      });
    }
    if (
      op === "addPullRequestReviewThreadReply" &&
      input?.["body"] !== "no reply"
    )
      threads
        .find((t) => t.id === input?.["pullRequestReviewThreadId"])
        ?.comments.nodes.push(
          by(
            input?.["pullRequestReviewId"],
            input?.["body"],
            `C${calls.length}`,
          ),
        );
    const data: Record<string, unknown> = {
      pull: {
        viewer: { login: "me" },
        repository: {
          pullRequest: {
            id: "PR",
            reviews: { nodes: pending ? [{ id: pending }] : [] },
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: threads,
            },
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
  return { client, target, calls, threads };
}
interface FakeComment {
  id: string;
  body: string;
  state: "PENDING" | "SUBMITTED";
  author: { login: string } | null;
  /** Which review holds it; GitHub keeps this, the store reads only `state`. */
  review?: string;
}
interface FakeThread {
  id: string;
  path: string;
  diffSide: "LEFT" | "RIGHT";
  line: number | null;
  startLine: number | null;
  isOutdated: boolean;
  subjectType: "LINE" | "FILE";
  comments: { nodes: FakeComment[] };
}
const lines = async () => [{ start: 2, end: 2 }];
/** Anchors a thread on the node numbered by its first line, so a test reads back which lines were asked for. */
const onLines = async (
  side: "before" | "after",
  path: string,
  range: { start: number; end: number },
) => ({ side, path, nodes: [[range.start, range.end]] });
const beforeSha = "b".repeat(40);
const afterSha = "a".repeat(40);
const changes = async () => [
  {
    path: "src/a.ts",
    before: `o/r@${beforeSha}`,
    after: `o/r@${afterSha}`,
  },
];
/** The writes, without the pending-review reads every write starts with. */
const writes = <C extends { op: string }>(calls: C[]) =>
  calls.filter((c) => c.op !== "pull");

// "Add single comment" on GitHub is a review submitted at once; left pending, it would show to nobody but its author.
test("a single comment is posted as a review submitted at once with COMMENT", async () => {
  const { client, target, calls } = fakeGitHub(undefined);
  const store = githubCommentStore(client, target, lines, onLines, changes);
  await store.comment(anchor, "hi", -1);
  expect(writes(calls).map((c) => c.op)).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "submitPullRequestReview",
  ]);
  expect(writes(calls)[0]?.variables).toEqual({ pr: "PR", commit: "HEAD" });
  expect(writes(calls)[1]?.variables["input"]).toEqual({
    pullRequestReviewId: "R1",
    body: [
      "-1: would rather not",
      "",
      "hi",
      "",
      "<details>",
      "<summary>hihyou</summary>",
      "",
      "Written in hihyou on node [0] of `src/a.ts` (after side), blobs bbbbbbb → aaaaaaa.",
      "",
      "</details>",
      "",
      `<!-- hihyou {"anchor":{"side":"after","path":"src/a.ts","nodes":[[0]]},"before":"${beforeSha}","after":"${afterSha}","score":-1} -->`,
    ].join("\n"),
    path: "src/a.ts",
    subjectType: "LINE",
    side: "RIGHT",
    line: 2,
  });
  expect(writes(calls)[2]?.variables).toEqual({
    review: "R1",
    event: "COMMENT",
  });
  expect(store.all()).toMatchObject([
    { body: "-1: would rather not\n\nhi", pending: false },
  ]);
  expect(store.reviewing()).toBe(false);
});

// GitHub allows one pending review per reviewer, so starting a second beside one begun on github.com would fail.
test("review comments join the pending review already on GitHub and stay pending until submitted", async () => {
  const { client, target, calls } = fakeGitHub("R0");
  const store = githubCommentStore(client, target, lines, onLines, changes);
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
  const store = githubCommentStore(client, target, lines, onLines, changes);

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
    const store = githubCommentStore(client, target, lines, onLines, changes);
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
  const store = githubCommentStore(client, target, lines, onLines, changes);
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
  const store = githubCommentStore(client, target, lines, onLines, changes);
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
  const a = githubCommentStore(
    github.client,
    github.target,
    lines,
    onLines,
    changes,
  );
  const b = githubCommentStore(
    github.client,
    github.target,
    lines,
    onLines,
    changes,
  );
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

/** A thread on GitHub as another reviewer, or the viewer on github.com, left it. */
const seeded = (
  id: string,
  over: Partial<FakeThread>,
  ...comments: [login: string, body: string, pending?: boolean][]
): FakeThread => ({
  id,
  path: "src/a.ts",
  diffSide: "RIGHT",
  line: 3,
  startLine: null,
  isOutdated: false,
  subjectType: "LINE",
  ...over,
  comments: {
    nodes: comments.map(([login, body, pending], i) => ({
      id: `${id}c${i}`,
      body,
      state: pending ? "PENDING" : "SUBMITTED",
      author: { login },
    })),
  },
});

// Opening a pull request showed only the threads written in that view, so other reviewers' threads, and the viewer's
// own pending review from github.com, were invisible and `r` could not answer them.
test("threads already on the pull request load with replies, authors and pending state, on the nodes of their lines", async () => {
  const { client, target } = fakeGitHub("R0", 0, [
    seeded(
      "TA",
      { startLine: 3, line: 5 },
      ["alice", "why?"],
      ["me", "because", true],
    ),
    seeded("TB", {}, ["bob", "Lines 18-30 (after):\n\nwhole function"]),
  ]);
  const store = githubCommentStore(client, target, lines, onLines, changes);
  await store.refresh();
  expect(store.reviewing()).toBe(true);
  expect(store.all()).toEqual([
    {
      id: "TA",
      anchor: { side: "after", path: "src/a.ts", nodes: [[3, 5]] },
      body: "why?",
      pending: false,
      author: "alice",
    },
    {
      id: "TAc1",
      anchor: { side: "after", path: "src/a.ts", nodes: [[3, 5]] },
      body: "because",
      pending: true,
      author: "me",
      thread: "TA",
    },
    // hihyou clamped this one to its hunk and named the node's own lines ahead of the body; those place it.
    {
      id: "TB",
      anchor: { side: "after", path: "src/a.ts", nodes: [[18, 30]] },
      body: "whole function",
      pending: false,
      author: "bob",
    },
  ]);
});

// A thread whose lines the compared blob does not hold has no node to sit on; without a defined place it vanished.
test("a file-level, outdated, or unanchorable thread is anchored to its file's root, on the side GitHub names", async () => {
  const { client, target } = fakeGitHub(undefined, 0, [
    seeded("TF", { subjectType: "FILE", line: null }, ["carol", "file"]),
    seeded("TO", { isOutdated: true, diffSide: "LEFT", line: null }, [
      "dave",
      "Line 9 (before):\n\nold",
    ]),
    seeded("TX", { line: 4 }, ["erin", "no tree"]),
  ]);
  const noTree = async () => {
    throw new RangeError("src/a.ts has no syntax tree to anchor in");
  };
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const store = githubCommentStore(client, target, lines, noTree, changes);
  await store.refresh();
  expect(errors).toHaveBeenCalledTimes(1);
  errors.mockRestore();
  expect(store.all().map((n) => [n.id, n.anchor, n.body])).toEqual([
    ["TF", { side: "after", path: "src/a.ts", nodes: [[]] }, "file"],
    // An outdated thread's prefix counts lines of a blob no longer shown, so it stays in the body.
    [
      "TO",
      { side: "before", path: "src/a.ts", nodes: [[]] },
      "Line 9 (before):\n\nold",
    ],
    ["TX", { side: "after", path: "src/a.ts", nodes: [[]] }, "no tree"],
  ]);
});

// The hidden key is untrusted: a stale or forged one must not move a thread onto a node its blob no longer holds,
// and without the key an outdated thread hihyou posted lost its node.
test("a thread's hidden key restores its anchor only while its blobs match, and a malformed key shows plain", async () => {
  const key = (before: string, extra = "") =>
    `<!-- hihyou {"anchor":{"side":"after","path":"src/a.ts","nodes":[[1,2]]},"before":"${before}","after":"${afterSha}"${extra}} -->`;
  const lowered = (before: string, extra?: string) =>
    `Line 9 (after):\n\nbody\n\n<details>\n<summary>hihyou</summary>\n\nWritten in hihyou.\n\n</details>\n\n${key(before, extra)}`;
  const { client, target } = fakeGitHub(undefined, 0, [
    seeded("TK", { isOutdated: true, line: null }, [
      "gina",
      lowered(beforeSha),
    ]),
    seeded("TS", { line: 4 }, ["hal", lowered("c".repeat(40))]),
    seeded("TM", { line: 5 }, ["ivy", lowered(beforeSha, ',"score":7')]),
  ]);
  const store = githubCommentStore(client, target, lines, onLines, changes);
  await store.refresh();
  expect(store.all().map((n) => [n.id, n.anchor, n.body, n.author])).toEqual([
    [
      "TK",
      { side: "after", path: "src/a.ts", nodes: [[1, 2]] },
      "body",
      "gina",
    ],
    ["TS", { side: "after", path: "src/a.ts", nodes: [[9, 9]] }, "body", "hal"],
    [
      "TM",
      { side: "after", path: "src/a.ts", nodes: [[9, 9]] },
      lowered(beforeSha, ',"score":7').replace("Line 9 (after):\n\n", ""),
      "ivy",
    ],
  ]);
});

// Another reviewer's new thread stayed out of an open view until it was reopened, so it could not be answered.
test("a refresh picks up another reviewer's new thread, which a reply then answers on its own id", async () => {
  const { client, target, calls, threads } = fakeGitHub(undefined);
  const store = githubCommentStore(client, target, lines, onLines, changes);
  const heard = vi.fn();
  const stop = store.subscribe(heard);
  await store.refresh();
  expect(store.all()).toEqual([]);
  threads.push(seeded("TN", { line: 7 }, ["frank", "new"]));
  await store.refresh();
  expect(heard).toHaveBeenCalled();
  expect(store.all()).toMatchObject([{ id: "TN", author: "frank" }]);
  await store.reply("TN", "answer");
  expect(
    calls.find((c) => c.op === "addPullRequestReviewThreadReply")?.variables,
  ).toMatchObject({ input: { pullRequestReviewThreadId: "TN" } });
  expect(store.all()).toMatchObject([
    { id: "TN" },
    { body: "answer", thread: "TN", author: "me", pending: false },
  ]);
  stop();
});
