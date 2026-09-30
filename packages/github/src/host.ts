import { syntechsGrammars } from "@hihyou/engine";
import type { GrammarLoader, Host, HostPreferences } from "@hihyou/engine";
import { readGitHubBlob } from "./blob.js";
import { createGitHubClient } from "./client.js";
import type { GitHubClientOptions } from "./client.js";
import {
  type DiffsetResolution,
  type GitHubDiffsetId,
  resolveGitHubDiffset,
} from "./diffset.js";
import {
  type GitHubPullRequest,
  listPullRequests,
  resolvePullRequest,
} from "./pulls.js";

export interface GitHubHostOptions extends GitHubClientOptions {
  /** Defaults to `syntechsGrammars()` with no formatting bound in (files shown as written). */
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
    ...(options.preferences && { preferences: options.preferences }),
  };
}
