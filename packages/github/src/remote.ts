export interface GitHubRemote {
  owner: string;
  repo: string;
}

const patterns = [
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

/** github.com only, matching the runtime's "no Enterprise" scope; an Enterprise host parses to `undefined`. */
export function parseGitHubRemote(url: string): GitHubRemote | undefined {
  const trimmed = url.trim();
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    const owner = match?.[1];
    const repo = match?.[2];
    if (owner && repo) return { owner, repo };
  }
  return undefined;
}
