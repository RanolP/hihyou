/**
 * The UI's `CommentStore` on GitHub's own review API: a single comment is a review submitted at once, and a
 * started review is GitHub's pending review, so a review started on github.com is the one comments join here.
 * GraphQL rather than REST, because only GraphQL adds a thread to an existing pending review by its id and takes a
 * file-level thread.
 */
import type { AnchorData, LineRange } from "@hihyou/engine";
import type { CommentStore, ReviewEvent, ReviewNote } from "@hihyou/ui";
import type { GitHubClient } from "./client.js";
import { fetchCompareFiles } from "./diffset.js";

/** The pull request a store comments on, and the Diffset's base and head, which its lines are counted in. */
export interface GitHubReviewTarget {
  owner: string;
  repo: string;
  number: number;
  base: string;
  head: string;
}

/** Each side's lines a file's diff hunks cover, as GitHub takes a review comment only on those. */
export interface HunkLines {
  before: LineRange[];
  after: LineRange[];
}

/** Where `addPullRequestReviewThread` places a comment, and the text put ahead of the body when it moved. */
export interface ThreadPlace {
  path: string;
  subjectType: "LINE" | "FILE";
  side?: "LEFT" | "RIGHT";
  line?: number;
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  /** Names the anchored lines when GitHub's place does not cover all of them. */
  prefix?: string;
}

/** The covered ranges of a file's `patch` (`@@ -a,b +c,d @@` headers); an empty side covers nothing. */
export function hunkLines(patch: string | undefined): HunkLines {
  const out: HunkLines = { before: [], after: [] };
  for (const m of (patch ?? "").matchAll(
    /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    const add = (list: LineRange[], start: string, count = "1") => {
      const n = Number(count);
      if (n > 0)
        list.push({ start: Number(start), end: Number(start) + n - 1 });
    };
    add(out.before, m[1] as string, m[2]);
    add(out.after, m[3] as string, m[4]);
  }
  return out;
}

/**
 * GitHub takes a comment only on lines of one hunk of its diff, while a node can reach past the hunk (a whole
 * function) or lie outside every hunk (context revealed from an elided run). The comment goes on the hunk that
 * overlaps the node most, clamped to it, or on the file when none does; either way the body then names the node's
 * own lines. `chars` has no place on GitHub and stays in the anchor only.
 */
export function placeOf(
  path: string,
  anchor: AnchorData,
  ranges: readonly LineRange[],
  hunks: HunkLines | undefined,
): ThreadPlace {
  const first = ranges[0];
  const last = ranges.at(-1);
  if (!first || !last) return { path, subjectType: "FILE" };
  const span = { start: first.start, end: last.end };
  const named =
    span.start === span.end
      ? `Line ${span.start}`
      : `Lines ${span.start}-${span.end}`;
  const prefix = `${named} (${anchor.side}):\n\n`;
  let best: LineRange | undefined;
  for (const h of hunks?.[anchor.side] ?? []) {
    const start = Math.max(h.start, span.start);
    const end = Math.min(h.end, span.end);
    if (end >= start && (!best || end - start > best.end - best.start))
      best = { start, end };
  }
  if (!best) return { path, subjectType: "FILE", prefix };
  const side = anchor.side === "before" ? "LEFT" : "RIGHT";
  return {
    path,
    subjectType: "LINE",
    side,
    line: best.end,
    ...(best.start !== best.end && { startLine: best.start, startSide: side }),
    ...((best.start !== span.start || best.end !== span.end) && { prefix }),
  };
}

const pullQuery = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { id reviews(first: 1, states: [PENDING]) { nodes { id } } }
  }
}`;
const startReview = `mutation($pr: ID!, $commit: GitObjectID!) {
  addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit }) { pullRequestReview { id } }
}`;
const addThread = `mutation($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) { thread { id } }
}`;
const submit = `mutation($review: ID!, $event: PullRequestReviewEvent!) {
  submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event }) { pullRequestReview { id } }
}`;
const deleteReview = `mutation($review: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $review }) { pullRequestReview { id } }
}`;

interface PullData {
  repository: {
    pullRequest: { id: string; reviews: { nodes: { id: string }[] } } | null;
  } | null;
}

/**
 * `lines` places an anchor in the side's blob as written, which is what GitHub's diff counts: the engine's
 * `Diffset.anchor(data).intoLineRanges()`. Requests run one at a time, so two comments sent together never start
 * two reviews.
 */
export function githubCommentStore(
  client: GitHubClient,
  target: GitHubReviewTarget,
  lines: (anchor: AnchorData) => Promise<LineRange[]>,
): CommentStore {
  const { owner, repo, number, base, head } = target;
  let notes: readonly ReviewNote[] = [];
  /** GitHub's pending review, once one is known to exist. */
  let reviewId: string | undefined;
  let pull: Promise<string> | undefined;
  let files:
    | Promise<Map<string, { path: string; hunks: HunkLines }>>
    | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const l of listeners) l();
  };
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  /** The pull request's node id, and the pending review the viewer may already have on github.com. */
  const pullId = () =>
    (pull ??= client
      .graphql<PullData>(pullQuery, { owner, repo, number })
      .then((data) => {
        const pr = data.repository?.pullRequest;
        if (!pr) throw new Error(`${owner}/${repo}#${number} was not found`);
        const pending = pr.reviews.nodes[0]?.id;
        if (pending !== undefined && reviewId === undefined) {
          reviewId = pending;
          changed();
        }
        return pr.id;
      })
      .catch((error: unknown) => {
        pull = undefined;
        throw error;
      }));
  /** Per anchor path (a renamed file's before side is its old path), GitHub's path and hunks. */
  const filesByPath = () =>
    (files ??= fetchCompareFiles(client, owner, repo, base, head)
      .then(({ files }) => {
        const out = new Map<string, { path: string; hunks: HunkLines }>();
        for (const f of files) {
          const entry = { path: f.filename, hunks: hunkLines(f.patch) };
          out.set(`after\n${f.filename}`, entry);
          out.set(`before\n${f.previous_filename ?? f.filename}`, entry);
        }
        return out;
      })
      .catch((error: unknown) => {
        files = undefined;
        throw error;
      }));

  const thread = async (review: string, anchor: AnchorData, body: string) => {
    const [ranges, byPath] = await Promise.all([lines(anchor), filesByPath()]);
    const file = byPath.get(`${anchor.side}\n${anchor.path}`);
    const { prefix = "", ...place } = placeOf(
      file?.path ?? anchor.path,
      anchor,
      ranges,
      file?.hunks,
    );
    const data = await client.graphql<{
      addPullRequestReviewThread: { thread: { id: string } | null };
    }>(addThread, {
      input: { pullRequestReviewId: review, body: prefix + body, ...place },
    });
    const id = data.addPullRequestReviewThread.thread?.id;
    if (id === undefined)
      throw new Error(
        `GitHub made no thread for a comment on ${anchor.path}; the line may lie outside the pull request's diff`,
      );
    return id;
  };
  const start = async () => {
    const pr = await pullId();
    if (reviewId !== undefined) return reviewId;
    const data = await client.graphql<{
      addPullRequestReview: { pullRequestReview: { id: string } };
    }>(startReview, { pr, commit: head });
    reviewId = data.addPullRequestReview.pullRequestReview.id;
    return reviewId;
  };
  const publish = async (review: string, event: ReviewEvent) => {
    await client.graphql(submit, { review, event });
  };

  void pullId().catch((error: unknown) =>
    console.error(`hihyou: could not read ${owner}/${repo}#${number}`, error),
  );
  return {
    all: () => notes,
    reviewing: () => reviewId !== undefined,
    comment: (anchor, body) =>
      serial(async () => {
        await pullId();
        if (reviewId !== undefined)
          throw new Error(
            "a review is started; a comment can only join it until it is submitted",
          );
        const review = await start();
        try {
          const id = await thread(review, anchor, body);
          await publish(review, "COMMENT");
          reviewId = undefined;
          notes = [...notes, { id, anchor, body, pending: false }];
          changed();
        } catch (error) {
          // `start()` always begins this call's review, so deleting it here cannot drop one the user began on
          // github.com; otherwise the empty PENDING review would strand `reviewing()` as true for every later
          // comment, this store's or a fresh one's.
          try {
            await client.graphql(deleteReview, { review });
          } catch {
            // the original error names the real failure; a delete failure here would only obscure it
          }
          reviewId = undefined;
          changed();
          throw error;
        }
      }),
    review: (anchor, body) =>
      serial(async () => {
        const id = await thread(await start(), anchor, body);
        notes = [...notes, { id, anchor, body, pending: true }];
        changed();
      }),
    submitReview: (event) =>
      serial(async () => {
        await pullId();
        if (reviewId === undefined) return;
        await publish(reviewId, event);
        reviewId = undefined;
        notes = notes.map((n) => (n.pending ? { ...n, pending: false } : n));
        changed();
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
