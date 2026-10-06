import { syntechsGrammars } from "@hihyou/engine";
import type {
  AnchorData,
  ChangedFileRef,
  GrammarLoader,
  Host,
  HostPreferences,
  LineRange,
} from "@hihyou/engine";
import type { CommentStore } from "@hihyou/ui";
import { readGitHubBlob } from "./blob.js";
import { createGitHubClient } from "./client.js";
import type { GitHubClientOptions } from "./client.js";
import { type GitHubReviewTarget, githubCommentStore } from "./comments.js";
import {
  type DiffsetResolution,
  type GitHubDiffsetId,
  resolveGitHubDiffset,
} from "./diffset.js";
import {
  type GitHubCommit,
  type GitHubPullRequest,
  listPullRequestCommits,
  listPullRequests,
  resolvePullRequest,
} from "./pulls.js";

export interface GitHubHostOptions extends GitHubClientOptions {
  /** Defaults to `syntechsGrammars()` with default formatting for each supported language. */
  grammars?: GrammarLoader;
  preferences?: HostPreferences;
}

export interface GitHubHost extends Host {
  resolveDiffset(data: GitHubDiffsetId): Promise<DiffsetResolution>;
  resolvePullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullRequest>;
  listPullRequests(owner: string, repo: string): Promise<GitHubPullRequest[]>;
  listPullRequestCommits(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubCommit[]>;
  /**
   * The pull request's review comments, kept on GitHub; `lines` places an anchor in the blob it names, and
   * `onLines` anchors a thread read back on lines of that blob, and `changes` is the Diffset's files, whose blobs
   * key what is posted (`githubCommentStore`).
   */
  reviewComments(
    target: GitHubReviewTarget,
    lines: (anchor: AnchorData) => Promise<LineRange[]>,
    onLines: (
      side: "before" | "after",
      path: string,
      lines: LineRange,
    ) => Promise<AnchorData>,
    changes: () => Promise<readonly ChangedFileRef[]>,
  ): CommentStore;
}

/** A browser-safe GitHub `Host` for `@hihyou/engine`: fetch only, no Node APIs. */
export function githubHost(options: GitHubHostOptions): GitHubHost {
  const client = createGitHubClient(options);
  return {
    grammars: options.grammars ?? syntechsGrammars(),
    resolveDiffset: (data: GitHubDiffsetId) =>
      resolveGitHubDiffset(client, data),
    readBlob: (id) => readGitHubBlob(client, id),
    resolvePullRequest: (owner, repo, number) =>
      resolvePullRequest(client, owner, repo, number),
    listPullRequests: (owner, repo) => listPullRequests(client, owner, repo),
    listPullRequestCommits: (owner, repo, number) =>
      listPullRequestCommits(client, owner, repo, number),
    reviewComments: (target, lines, onLines, changes) =>
      githubCommentStore(client, target, lines, onLines, changes),
    ...(options.preferences && { preferences: options.preferences }),
  };
}
