const PR_PATH =
  /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(files|commits|changes)(?:\/(.+))?)?$/;

export interface PrLocation {
  owner: string;
  repo: string;
  number: number;
  view: 'conversation' | 'files' | 'commits' | 'changes';
  /** For the changes view: a commit oid or `a..b` range. */
  range?: string;
}

export function parsePrLocation(url: URL): PrLocation | null {
  const m = PR_PATH.exec(url.pathname);
  if (!m) return null;
  const view = (m[4] as PrLocation['view'] | undefined) ?? 'conversation';
  return {
    owner: m[1],
    repo: m[2],
    number: Number(m[3]),
    view,
    ...(view === 'changes' && m[5] ? { range: m[5] } : {}),
  };
}
