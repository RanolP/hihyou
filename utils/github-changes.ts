/**
 * Access to GitHub's React "changes" route payload (the new PR files view).
 *
 * On a hard page load the payload is embedded as JSON inside
 * `react-app[app-name="pull-requests"]`. Commit/range navigation inside the
 * changes view is a soft navigation: the app re-fetches the same URL with
 * `Accept: application/json` and the embedded script goes stale — so only
 * trust the embedded payload for the initial load, and fetch afterwards.
 */

export interface DiffLine {
  /** 'context' | 'addition' | 'deletion' | 'hunk' | 'injected_context' ... */
  type: string;
  blobLineNumber: number;
  text: string;
  /** GitHub's own syntax-highlighted rendering of the line. */
  html: string;
  left?: number;
  right?: number;
  position?: number;
}

export interface TreeEntry {
  mode: number;
  path: string;
  lineCount?: number;
}

export interface DiffContent {
  isBinary: boolean;
  isSubmodule: boolean;
  isTooBig: boolean;
  diffLines?: DiffLine[];
  oldCommitOid: string;
  newCommitOid: string;
  oldTreeEntry?: TreeEntry;
  newTreeEntry?: TreeEntry;
  linesAdded: number;
  linesDeleted: number;
  linesChanged: number;
}

export interface DiffSummary {
  changeType: string;
  path: string;
  /** sha256 of the path; the file's DOM container is `#diff-<pathDigest>`. */
  pathDigest: string;
  markedAsViewed: boolean;
  linesAdded: number;
  linesDeleted: number;
  linesChanged: number;
}

export interface CommitInfo {
  oid: string;
  parents?: { oid: string }[];
  [key: string]: unknown;
}

export interface ChangesPayload {
  isSingleFileMode: boolean;
  commits: CommitInfo[];
  diffSummaries: DiffSummary[];
  diffContents: DiffContent[];
  /** Present on commit/range-scoped views. */
  commit?: CommitInfo;
  virtualizeDiffEntries: boolean;
  [key: string]: unknown;
}

/** Both route flavors carry the same shape under different keys. */
function pickChangesRoute(payload: Record<string, unknown>): ChangesPayload | null {
  return (
    (payload.pullRequestsChangesRoute as ChangesPayload | undefined) ??
    (payload.pullRequestsChangesWithRangeRoute as ChangesPayload | undefined) ??
    null
  );
}

export function readEmbeddedChangesPayload(): ChangesPayload | null {
  const script = document.querySelector(
    'react-app[app-name="pull-requests"] script[data-target="react-app.embeddedData"]',
  );
  if (!script?.textContent) return null;
  try {
    return pickChangesRoute(JSON.parse(script.textContent).payload ?? {});
  } catch {
    return null;
  }
}

export async function fetchChangesPayload(
  pathname: string,
): Promise<ChangesPayload | null> {
  const res = await fetch(pathname, { headers: { Accept: 'application/json' } });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
    return null;
  }
  return pickChangesRoute((await res.json()).payload ?? {});
}

/** Full file content at a commit, using the viewer's GitHub session. */
export async function fetchRawBlob(
  owner: string,
  repo: string,
  oid: string,
  path: string,
): Promise<string | null> {
  const res = await fetch(
    `/${owner}/${repo}/raw/${oid}/${path}`,
    { headers: { Accept: 'text/plain' } },
  );
  return res.ok ? res.text() : null;
}

/**
 * The rendered container for a file's diff. May not exist yet for far-away
 * files when GitHub virtualizes large PRs (`virtualizeDiffEntries`).
 */
export function diffContainer(summary: Pick<DiffSummary, 'pathDigest'>): HTMLElement | null {
  return document.getElementById(`diff-${summary.pathDigest}`);
}
