import type { GitHubClient } from "./client.js";

export interface GitHubPullRequest {
  number: number;
  title: string;
  base: string; // sha
  head: string; // sha
}

interface PullResponse {
  number: number;
  title: string;
  base: { sha: string };
  head: { sha: string };
}

export async function resolvePullRequest(
  client: GitHubClient,
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubPullRequest> {
  const pr = await client.get<PullResponse>(
    `/repos/${owner}/${repo}/pulls/${number}`,
  );
  return {
    number: pr.number,
    title: pr.title,
    base: pr.base.sha,
    head: pr.head.sha,
  };
}

/** Open PRs, first page only, for a quick pick — not a full paginated listing. */
export async function listPullRequests(
  client: GitHubClient,
  owner: string,
  repo: string,
): Promise<GitHubPullRequest[]> {
  const prs = await client.get<PullResponse[]>(
    `/repos/${owner}/${repo}/pulls`,
    {
      state: "open",
    },
  );
  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    base: pr.base.sha,
    head: pr.head.sha,
  }));
}

export interface GitHubCommit {
  sha: string;
  /** The first parent's sha; absent on a root commit. */
  parent?: string;
  message: string;
  author: string;
  /** ISO 8601, as GitHub reports the author date. */
  date: string;
}

interface CommitResponse {
  sha: string;
  parents: { sha: string }[];
  commit: { message: string; author: { name: string; date: string } | null };
}

/** A PR's commits, oldest first: the first page of 100 only (GitHub caps the endpoint at 250). */
export async function listPullRequestCommits(
  client: GitHubClient,
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubCommit[]> {
  const commits = await client.get<CommitResponse[]>(
    `/repos/${owner}/${repo}/pulls/${number}/commits`,
    { per_page: 100 },
  );
  return commits.map((c) => ({
    sha: c.sha,
    ...(c.parents[0] && { parent: c.parents[0].sha }),
    message: c.commit.message,
    author: c.commit.author?.name ?? "",
    date: c.commit.author?.date ?? "",
  }));
}
