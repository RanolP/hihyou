/**
 * The UI's `CommentStore` on GitHub's own review API: a single comment is a review submitted at once, and a
 * started review is GitHub's pending review, so a review started on github.com is the one comments join here.
 * GraphQL rather than REST, because only GraphQL adds a thread to an existing pending review by its id and takes a
 * file-level thread.
 */
import type {
  AnchorData,
  BlobId,
  ChangedFileRef,
  LineRange,
} from "@hihyou/engine";
import type { CommentStore, ReviewEvent, ReviewNote, Score } from "@hihyou/ui";
import { decodeBlobId } from "./blob.js";
import type { GitHubClient } from "./client.js";
import { fetchCompareFiles } from "./diffset.js";
import {
  type LoweredKey,
  lowerComment,
  readLowered,
  withVerdict,
} from "./lowered.js";

/**
 * The pull request a store comments on, and the Diffset's base and head, which its lines are counted in: one commit
 * of the pull request (`head`) against its first parent (`base`). Comments go on the pull request at that commit.
 */
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
 * A line's position in a file's `patch`, which the deprecated `addPullRequestReviewComment` takes: the row below
 * the first `@@` header is 1, and every later row, a later header included, counts on.
 */
export function positionOf(
  patch: string | undefined,
  side: "LEFT" | "RIGHT",
  line: number,
): number | undefined {
  let before = 0;
  let after = 0;
  for (const [i, row] of (patch ?? "").split("\n").entries()) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(row);
    if (m) {
      before = Number(m[1]);
      after = Number(m[2]);
      continue;
    }
    if (row.startsWith("\\")) continue;
    const old = row.startsWith("+") ? undefined : before++;
    const now = row.startsWith("-") ? undefined : after++;
    if ((side === "LEFT" ? old : now) === line) return i;
  }
  return undefined;
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

/** The pull request, the viewer's pending review, and one page of its review threads with their comments. */
const pullQuery = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id baseRefOid headRefOid
      reviews(first: 1, states: [PENDING]) { nodes { id commit { oid } } }
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id path diffSide line startLine originalLine originalStartLine isOutdated subjectType
          comments(first: 100) { nodes { id body state author { login } originalCommit { oid } } }
        }
      }
    }
  }
}`;
const startReview = `mutation($pr: ID!, $commit: GitObjectID!, $threads: [DraftPullRequestReviewThread]) {
  addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit, threads: $threads }) {
    pullRequestReview { id comments(first: 1) { nodes { id } } }
  }
}`;
const addThread = `mutation($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) { thread { id } }
}`;
const addComment = `mutation($input: AddPullRequestReviewCommentInput!) {
  addPullRequestReviewComment(input: $input) { comment { id } }
}`;
const addReply = `mutation($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { id } }
}`;
const submit = `mutation($review: ID!, $event: PullRequestReviewEvent!) {
  submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event }) { pullRequestReview { id } }
}`;
const deleteReview = `mutation($review: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $review }) { pullRequestReview { id } }
}`;

interface ThreadData {
  id: string;
  path: string;
  diffSide: "LEFT" | "RIGHT";
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  isOutdated: boolean;
  subjectType: "LINE" | "FILE";
  comments: {
    nodes: {
      id: string;
      body: string;
      state: "PENDING" | "SUBMITTED";
      author: { login: string } | null;
      originalCommit: { oid: string } | null;
    }[];
  };
}

interface PullData {
  viewer: { login: string };
  repository: {
    pullRequest: {
      id: string;
      baseRefOid: string;
      headRefOid: string;
      reviews: { nodes: { id: string; commit: { oid: string } | null }[] };
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ThreadData[];
      };
    } | null;
  } | null;
}

/** `placeOf`'s prefix, which names the anchored lines a moved comment's place does not cover. */
const placedPrefix = /^Lines? (\d+)(?:-(\d+))? \((before|after)\):\n\n/;

/** How a thread's lines relate to the Diffset shown, one commit of the pull request (`threadLines`). */
export interface ThreadAt {
  /** The thread was written at this commit, so its original lines and `placeOf`'s prefix count here. */
  written: boolean;
  /** This commit is the pull request's head, so the lines GitHub still places a thread on count here. */
  current: boolean;
  /** This commit's parent is the merge base, whose blob GitHub counts a LEFT line in. */
  leftIsBefore: boolean;
}

/**
 * Where a thread read from GitHub points, before it is anchored to nodes: the lines `placeOf`'s prefix names when
 * hihyou moved the comment at this commit, else the thread's own lines when they count here (`ThreadAt`); none
 * for a file-level thread, or one whose lines this Diffset's blobs do not hold.
 */
export function threadLines(
  thread: Pick<
    ThreadData,
    | "diffSide"
    | "line"
    | "startLine"
    | "originalLine"
    | "originalStartLine"
    | "isOutdated"
    | "subjectType"
  >,
  body: string,
  at: ThreadAt,
): { side: "before" | "after"; range?: LineRange; body: string } {
  const side = thread.diffSide === "LEFT" ? "before" : "after";
  const m = at.written ? placedPrefix.exec(body) : null;
  if (m) {
    const start = Number(m[1]);
    return {
      side: m[3] as "before" | "after",
      range: { start, end: m[2] === undefined ? start : Number(m[2]) },
      body: body.slice(m[0].length),
    };
  }
  const [line, startLine] = at.written
    ? [thread.originalLine, thread.originalStartLine]
    : at.current && !thread.isOutdated
      ? [thread.line, thread.startLine]
      : [null, null];
  if (
    thread.subjectType === "FILE" ||
    !line ||
    (side === "before" && !at.leftIsBefore)
  )
    return { side, body };
  return { side, range: { start: startLine ?? line, end: line }, body };
}

/**
 * `lines` places an anchor in the side's blob as written, which is what GitHub's diff counts: the engine's
 * `Diffset.anchor(data).intoLineRanges()`; `onLines` is its inverse, `Diffset.anchorOnLines`, which anchors a
 * thread read from GitHub. `changes` is the Diffset's files, whose blobs a posted comment's hidden key names and
 * a key read back must still match. Requests run one at a time, so two comments sent together never start two
 * reviews.
 */
export function githubCommentStore(
  client: GitHubClient,
  target: GitHubReviewTarget,
  lines: (anchor: AnchorData) => Promise<LineRange[]>,
  onLines: (
    side: "before" | "after",
    path: string,
    lines: LineRange,
  ) => Promise<AnchorData>,
  changes: () => Promise<readonly ChangedFileRef[]>,
): CommentStore {
  const { owner, repo, number, base, head } = target;
  let notes: readonly ReviewNote[] = [];
  /** GitHub's pending review, once one is known to exist, and the commit it comments on. */
  let reviewId: string | undefined;
  let reviewCommit: string | undefined;
  /** The pull request's base and head commits, as last read. */
  let pull: { base: string; head: string } | undefined;
  let files:
    | Promise<{
        mergeBase: string;
        byPath: Map<
          string,
          { path: string; patch: string | undefined; hunks: HunkLines }
        >;
      }>
    | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  /** Open while anyone listens, so a disposed view leaves no channel keeping a Node process alive. */
  let channel: BroadcastChannel | undefined;
  /** `heard`: the change was read from GitHub, not written here, so the other stores need no nudge. */
  const changed = (heard = false) => {
    for (const l of listeners) l();
    if (!heard) channel?.postMessage("changed");
  };
  const readFailed = (error: unknown) =>
    console.error(`hihyou: could not read ${owner}/${repo}#${number}`, error);
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  const shaOf = (id: BlobId | null) =>
    id === null ? null : decodeBlobId(id).sha;
  /** The file `anchor` lies in, as the Diffset holds it; a renamed file's before side goes by its old path. */
  const fileOf = async (anchor: AnchorData) =>
    (await changes()).find(
      (c) =>
        (anchor.side === "before" ? (c.oldPath ?? c.path) : c.path) ===
        anchor.path,
    );
  /**
   * The anchor a thread's hidden key names, when its file is the thread's own and both its blobs are still the
   * ones the key was written on, so its `AstSteps` name the same nodes; an outdated thread reattaches this way.
   */
  const keyed = async (thread: ThreadData, key: LoweredKey) => {
    try {
      const file = await fileOf(key.anchor);
      if (
        file?.path === thread.path &&
        shaOf(file.before) === key.before &&
        shaOf(file.after) === key.after
      )
        return key.anchor;
    } catch (error) {
      console.error(
        `hihyou: could not check the key of a thread on ${thread.path}`,
        error,
      );
    }
    return undefined;
  };

  /** Who this store writes as, read with the threads, so a note written here names its author at once. */
  let viewer: string | undefined;
  /**
   * A thread's anchor: the one a note already held for it keeps (the node it was written on, `chars` included),
   * else the one its hidden key restores, else the nodes on its lines, else the file itself (its root node), where
   * a view lists what no node it draws holds.
   */
  const anchorOf = async (
    thread: ThreadData,
    side: "before" | "after",
    range: LineRange | undefined,
    key: LoweredKey | undefined,
  ): Promise<AnchorData> => {
    // A thread posted here may be known by its first comment's id, when GitHub answered with no thread id.
    const known = notes.find(
      (n) => n.id === thread.id || n.id === thread.comments.nodes[0]?.id,
    )?.anchor;
    if (known) return known;
    const restored = key && (await keyed(thread, key));
    if (restored) return restored;
    let path = thread.path;
    if (side === "before")
      for (const [key, f] of (await filesByPath()).byPath)
        if (f.path === thread.path && key.startsWith("before\n"))
          path = key.slice("before\n".length);
    // A thread on a file this commit leaves alone has no nodes here to look up.
    if (range && (await fileOf({ side, path, nodes: [] })))
      try {
        return await onLines(side, path, range);
      } catch (error) {
        console.error(
          `hihyou: could not find the nodes of a thread on ${path}`,
          error,
        );
      }
    return { side, path: thread.path, nodes: [[]] };
  };
  const mine = () => (viewer === undefined ? {} : { author: viewer });
  const notesOf = async (thread: ThreadData): Promise<ReviewNote[]> => {
    const [root, ...replies] = thread.comments.nodes;
    if (!root) return [];
    const lowered = readLowered(root.body);
    const {
      side,
      range,
      body: lined,
    } = threadLines(thread, lowered.body, {
      written: root.originalCommit?.oid === head,
      current: pull?.head === head,
      leftIsBefore: (await filesByPath()).mergeBase === base,
    });
    const anchor = await anchorOf(thread, side, range, lowered.key);
    // A valid key marks the body as hihyou's, so `placeOf`'s prefix goes even on an outdated thread.
    const body = lowered.key ? lowered.body.replace(placedPrefix, "") : lined;
    const note = (
      c: (typeof thread.comments.nodes)[number],
      text: string,
    ): ReviewNote => ({
      id: c.id,
      anchor,
      body: text,
      pending: c.state === "PENDING",
      ...(c.author && { author: c.author.login }),
    });
    return [
      { ...note(root, body), id: thread.id },
      ...replies.map((c) => ({ ...note(c, c.body), thread: thread.id })),
    ];
  };

  /**
   * The pull request's node id, after reading afresh which pending review the viewer has and every review thread
   * with its comments. GitHub is the only place they live, and another tab, another window, github.com itself or
   * another reviewer may have changed them since this store last looked; every write calls this first, so none
   * lands on a review already submitted.
   */
  const pullId = async () => {
    const threads: ThreadData[] = [];
    let after: string | null = null;
    let pr: NonNullable<NonNullable<PullData["repository"]>["pullRequest"]>;
    for (;;) {
      const data: PullData = await client.graphql<PullData>(pullQuery, {
        owner,
        repo,
        number,
        after,
      });
      const page = data.repository?.pullRequest;
      if (!page) throw new Error(`${owner}/${repo}#${number} was not found`);
      viewer = data.viewer.login;
      pr = page;
      threads.push(...page.reviewThreads.nodes);
      const { hasNextPage, endCursor } = page.reviewThreads.pageInfo;
      if (!hasNextPage || !endCursor) break;
      after = endCursor;
    }
    if (pull?.base !== pr.baseRefOid) files = undefined;
    pull = { base: pr.baseRefOid, head: pr.headRefOid };
    const read = (await Promise.all(threads.map(notesOf))).flat();
    const pending = pr.reviews.nodes[0]?.id;
    reviewCommit = pr.reviews.nodes[0]?.commit?.oid;
    if (
      pending !== reviewId ||
      JSON.stringify(read) !== JSON.stringify(notes)
    ) {
      notes = read;
      reviewId = pending;
      changed(true);
    }
    return pr.id;
  };
  /**
   * The other stores on this pull request, in other tabs of this origin or other panels of this process, hear each
   * change written here and re-read GitHub at once rather than at their next focus.
   */
  const listen = () => {
    if (typeof BroadcastChannel === "undefined") return undefined;
    const c = new BroadcastChannel(
      `hihyou:github-review:${owner}/${repo}#${number}`,
    );
    c.onmessage = () => void serial(pullId).catch(readFailed);
    return c;
  };
  /**
   * The pull request's diff at this commit, which GitHub places a comment on: its merge base, and per anchor path
   * (a renamed file's before side is its old path) GitHub's path and hunks. Read after `pullId`, which knows the
   * pull request's base.
   */
  const filesByPath = () =>
    (files ??= fetchCompareFiles(client, owner, repo, pull?.base ?? base, head)
      .then(({ mergeBaseSha, files }) => {
        const byPath = new Map<
          string,
          { path: string; patch: string | undefined; hunks: HunkLines }
        >();
        for (const f of files) {
          const entry = {
            path: f.filename,
            patch: f.patch,
            hunks: hunkLines(f.patch),
          };
          byPath.set(`after\n${f.filename}`, entry);
          byPath.set(`before\n${f.previous_filename ?? f.filename}`, entry);
        }
        return { mergeBase: mergeBaseSha, byPath };
      })
      .catch((error: unknown) => {
        files = undefined;
        throw error;
      }));

  /**
   * Posts the thread with its body lowered (`lowerComment`), keyed when the Diffset holds the anchor's file, into
   * `review`, or into a review it starts at this commit when there is none. Resolves to the thread's id, or to its
   * first comment's when GitHub answers with no thread.
   */
  const thread = async (
    pr: string,
    review: string | undefined,
    anchor: AnchorData,
    body: string,
    score: Score | undefined,
  ) => {
    const [ranges, { mergeBase, byPath }, file] = await Promise.all([
      lines(anchor),
      filesByPath(),
      fileOf(anchor),
    ]);
    const posted = file
      ? lowerComment(body, {
          anchor,
          before: shaOf(file.before),
          after: shaOf(file.after),
          ...(score !== undefined && { score }),
        })
      : withVerdict(body, score);
    const hunked = byPath.get(`${anchor.side}\n${anchor.path}`);
    // GitHub counts a LEFT line in the merge base, which only the first commit's before side is, so a later
    // commit's before side goes on the file.
    const {
      prefix = "",
      subjectType,
      ...place
    } = placeOf(
      hunked?.path ?? file?.path ?? anchor.path,
      anchor,
      ranges,
      anchor.side === "after" || mergeBase === base ? hunked?.hunks : undefined,
    );
    // GitHub places a review's starting threads at its commit (a draft with no line is a file comment), but
    // `addPullRequestReviewThread` places a later one on the pull request's head.
    if (review === undefined) {
      const data = await client.graphql<{
        addPullRequestReview: {
          pullRequestReview: {
            id: string;
            comments: { nodes: { id: string }[] };
          };
        };
      }>(startReview, {
        pr,
        commit: head,
        threads: [{ body: prefix + posted, ...place }],
      });
      const started = data.addPullRequestReview.pullRequestReview;
      reviewId = started.id;
      reviewCommit = head;
      const id = started.comments.nodes[0]?.id;
      if (id === undefined)
        throw new Error(
          `GitHub made no thread for a comment on ${anchor.path}; the line may lie outside the pull request's diff`,
        );
      return id;
    }
    if (head === pull?.head) {
      const data = await client.graphql<{
        addPullRequestReviewThread: { thread: { id: string } | null };
      }>(addThread, {
        input: {
          pullRequestReviewId: review,
          body: prefix + posted,
          subjectType,
          ...place,
        },
      });
      const id = data.addPullRequestReviewThread.thread?.id;
      if (id === undefined)
        throw new Error(
          `GitHub made no thread for a comment on ${anchor.path}; the line may lie outside the pull request's diff`,
        );
      return id;
    }
    // Off the head, only the deprecated `addPullRequestReviewComment` takes a commit: on one line, by its position.
    const position =
      place.side &&
      place.line !== undefined &&
      positionOf(hunked?.patch, place.side, place.line);
    if (!position)
      throw new Error(
        `a review started on commit ${head.slice(0, 7)} takes a file comment only as its first; submit the review, then comment on ${anchor.path}`,
      );
    const ranged =
      place.startLine === undefined || prefix
        ? prefix
        : `Lines ${place.startLine}-${place.line} (${anchor.side}):\n\n`;
    const data = await client.graphql<{
      addPullRequestReviewComment: { comment: { id: string } | null };
    }>(addComment, {
      input: {
        pullRequestReviewId: review,
        commitOID: head,
        path: place.path,
        position,
        body: ranged + posted,
      },
    });
    const id = data.addPullRequestReviewComment.comment?.id;
    if (id === undefined)
      throw new Error(`GitHub made no comment on ${anchor.path}`);
    return id;
  };
  /**
   * A pending review comments on one commit, and its event is that commit's approval, so this Diffset adds to or
   * submits only a review on its own commit.
   */
  const ownReview = () => {
    if (reviewId !== undefined && reviewCommit !== head)
      throw new Error(
        `a review is started on commit ${reviewCommit?.slice(0, 7) ?? "unknown"}; open that commit to add to it or submit it`,
      );
    return reviewId;
  };
  const start = async (pr: string) => {
    const own = ownReview();
    if (own !== undefined) return own;
    const data = await client.graphql<{
      addPullRequestReview: { pullRequestReview: { id: string } };
    }>(startReview, { pr, commit: head });
    reviewId = data.addPullRequestReview.pullRequestReview.id;
    reviewCommit = head;
    return reviewId;
  };
  const publish = async (review: string, event: ReviewEvent) => {
    await client.graphql(submit, { review, event });
  };
  /** The note that began thread `thread`, whose anchor a reply shares. */
  const rootOf = (thread: string) => {
    const root = notes.find((n) => n.id === thread && !n.thread);
    if (!root) throw new Error(`no thread ${thread}`);
    return root;
  };
  /** A reply to `thread` inside `review`: `addPullRequestReviewThreadReply` takes a thread by its id. */
  const reply = async (review: string, thread: string, body: string) => {
    const data = await client.graphql<{
      addPullRequestReviewThreadReply: { comment: { id: string } | null };
    }>(addReply, {
      input: {
        pullRequestReviewId: review,
        pullRequestReviewThreadId: thread,
        body,
      },
    });
    const id = data.addPullRequestReviewThreadReply.comment?.id;
    if (id === undefined)
      throw new Error(`GitHub made no reply on thread ${thread}`);
    return id;
  };
  /**
   * "Add single comment" or "Add single reply": `add` writes into a review it starts, which is then submitted with
   * COMMENT at once.
   */
  const single = async (
    what: string,
    add: (pr: string) => Promise<ReviewNote>,
  ) => {
    const pr = await pullId();
    if (reviewId !== undefined)
      throw new Error(
        `a review is started; a ${what} can only join it until it is submitted`,
      );
    try {
      const note = await add(pr);
      if (reviewId !== undefined) await publish(reviewId, "COMMENT");
      reviewId = undefined;
      notes = [...notes, note];
      changed();
    } catch (error) {
      // `add` always begins this call's review, so deleting it here cannot drop one the user began on
      // github.com; otherwise the empty PENDING review would strand `reviewing()` as true for every later
      // comment, this store's or a fresh one's.
      if (reviewId !== undefined)
        try {
          await client.graphql(deleteReview, { review: reviewId });
        } catch {
          // the original error names the real failure; a delete failure here would only obscure it
        }
      reviewId = undefined;
      changed();
      throw error;
    }
  };

  /**
   * Re-reads the threads once one is posted, as GitHub may have named it by its first comment, which a reply cannot
   * take; the post itself stands even when the read fails.
   */
  const threadIds = () => pullId().catch(readFailed);

  void serial(pullId).catch(readFailed);
  return {
    all: () => notes,
    reviewing: () => reviewId !== undefined,
    refresh: () =>
      serial(async () => {
        await pullId();
      }),
    comment: (anchor, body, score) =>
      serial(async () => {
        await single("comment", async (pr) => ({
          id: await thread(pr, undefined, anchor, body, score),
          anchor,
          body: withVerdict(body, score),
          pending: false,
          ...mine(),
        }));
        await threadIds();
      }),
    review: (anchor, body, score) =>
      serial(async () => {
        const pr = await pullId();
        const id = await thread(pr, ownReview(), anchor, body, score);
        notes = [
          ...notes,
          {
            id,
            anchor,
            body: withVerdict(body, score),
            pending: true,
            ...mine(),
          },
        ];
        changed();
        await threadIds();
      }),
    reply: (to, body) =>
      serial(() => {
        const { anchor } = rootOf(to);
        return single("reply", async (pr) => ({
          id: await reply(await start(pr), to, body),
          anchor,
          body,
          pending: false,
          thread: to,
          ...mine(),
        }));
      }),
    reviewReply: (to, body) =>
      serial(async () => {
        const { anchor } = rootOf(to);
        const id = await reply(await start(await pullId()), to, body);
        notes = [
          ...notes,
          { id, anchor, body, pending: true, thread: to, ...mine() },
        ];
        changed();
      }),
    submitReview: (event) =>
      serial(async () => {
        await pullId();
        const own = ownReview();
        if (own === undefined) return;
        await publish(own, event);
        reviewId = undefined;
        notes = notes.map((n) => (n.pending ? { ...n, pending: false } : n));
        changed();
      }),
    subscribe(listener) {
      listeners.add(listener);
      channel ??= listen();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        channel?.close();
        channel = undefined;
      };
    },
  };
}
