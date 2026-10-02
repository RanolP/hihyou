import { type GitHubRemote, parseGitHubRemote } from "@hihyou/github";
import type { LocalRepo } from "../local/repos.js";

export interface FoundRemote extends GitHubRemote {
  /** The git remote's name, e.g. `origin`. */
  name: string;
}

/** Each github.com repository the workspace's remotes point at, once, in the order the remotes list them. */
export async function githubRemotes(
  repos: readonly LocalRepo[],
): Promise<FoundRemote[]> {
  const found = new Map<string, FoundRemote>();
  for (const local of repos)
    for (const remote of await local.repo.readRemotes()) {
      const parsed = parseGitHubRemote(remote.url);
      const key = parsed && `${parsed.owner}/${parsed.repo}`.toLowerCase();
      if (parsed && key && !found.has(key))
        found.set(key, { ...parsed, name: remote.name });
    }
  return [...found.values()];
}
