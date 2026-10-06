export interface PullFilesPage {
  owner: string;
  repo: string;
  pull: number;
}

/** The pull request whose Files changed tab `href` is (`/pull/<n>/files` or `/changes`, any sub-path), if any. */
export function pullFilesPage(href: string): PullFilesPage | undefined {
  const url = new URL(href);
  if (url.origin !== "https://github.com") return undefined;
  const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/|$)/.exec(
    url.pathname,
  );
  if (!m) return undefined;
  return {
    owner: decodeURIComponent(m[1] as string),
    repo: decodeURIComponent(m[2] as string),
    pull: Number(m[3]),
  };
}
