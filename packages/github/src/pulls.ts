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
