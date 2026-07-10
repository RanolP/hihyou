/**
 * Stacked-PR chain resolution: a PR whose base branch is not the default
 * branch sits on top of the PR whose head IS that base branch. Following
 * the chain flattens into one continuous commit sequence.
 *
 * GitHub's layout payload has its own `stack` key but it is null outside
 * their experiment; base-branch chasing works everywhere.
 */

import {
  fetchChangesPayload,
  type ChangesPayload,
  type CommitInfo,
} from './github-changes';

export interface StackEntry {
  number: number;
  title: string;
  commits: CommitInfo[];
  isCurrent: boolean;
}

async function findOpenPrByHead(
  owner: string,
  repo: string,
  branch: string,
): Promise<number | null> {
  // api.github.com is inside github.com's connect-src; unauthenticated is
  // fine for one lookup per stack hop.
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) return null;
  const prs: { number: number }[] = await res.json();
  return prs[0]?.number ?? null;
}

export async function resolveStack(
  pr: { owner: string; repo: string; number: number },
  payload: ChangesPayload,
): Promise<StackEntry[]> {
  const entries: StackEntry[] = [
    {
      number: pr.number,
      title: payload.pullRequest?.title ?? '',
      commits: payload.commits,
      isCurrent: true,
    },
  ];
  const defaultBranch = payload.repository?.defaultBranch;
  let base = payload.pullRequest?.baseBranch;
  let guard = 0;
  while (defaultBranch && base && base !== defaultBranch && guard++ < 5) {
    const baseNumber = await findOpenPrByHead(pr.owner, pr.repo, base);
    if (!baseNumber || entries.some((e) => e.number === baseNumber)) break;
    const basePayload = await fetchChangesPayload(
      `/${pr.owner}/${pr.repo}/pull/${baseNumber}/changes`,
    );
    if (!basePayload) break;
    entries.unshift({
      number: baseNumber,
      title: basePayload.pullRequest?.title ?? '',
      commits: basePayload.commits,
      isCurrent: false,
    });
    base = basePayload.pullRequest?.baseBranch;
  }
  return entries;
}
