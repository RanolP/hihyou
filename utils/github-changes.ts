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
  /** 'CONTEXT' | 'ADDITION' | 'DELETION' | 'HUNK' | 'INJECTED_CONTEXT' ... */
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
  path: string;
  pathDigest: string;
  status?: string;
  truncatedReason?: string | null;
  /** Client-side marker: lazy fetch came back without this path. */
  unavailable?: boolean;
}

export interface Comparison {
  fullDiff: { baseOid: string; headOid: string };
  /** Set on commit/range-scoped views. */
  selectedRange: { baseOid: string; headOid: string } | null;
  viewing: string;
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
  /**
   * Line-anchored review markers, keyed by side+line (`R102` = right/new
   * side line 102, `L45` = left/old side).
   */
  markersMap?: Record<string, MarkerEntry>;
}

export interface MarkerEntry {
  threads: { id: number | string }[];
  annotations: unknown[];
  /** Context line range of the comment anchor. */
  ctx?: [number, number];
}

export interface ReviewCommentData {
  author: { login: string; avatarUrl: string };
  authorAssociation: string;
  body: string;
  bodyHTML: string;
  createdAt: string;
  databaseId: number;
  id: string;
  isHidden: boolean;
  state: string;
  viewerCanDelete: boolean;
  [key: string]: unknown;
}

export interface ReviewThread {
  id: string;
  subjectType: string;
  isResolved: boolean;
  resolvedBy?: string | null;
  viewerCanReply: boolean;
  commentsData: { comments: ReviewCommentData[] };
  pullRequestReviewId: number;
}

export interface Markers {
  threads: Record<string, ReviewThread>;
  annotations: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CommitInfo {
  oid: string;
  parents?: { oid: string }[];
  [key: string]: unknown;
}

export interface ChangesPayload {
  isSingleFileMode: boolean;
  commits: CommitInfo[];
  comparison: Comparison;
  diffSummaries: DiffSummary[];
  /** May cover only a prefix of diffSummaries on large PRs. */
  diffContents: DiffContent[];
  /** Present on commit/range-scoped views. */
  commit?: CommitInfo;
  markers: Markers;
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

/** The `range` query param GitHub's app sends to `page_data/diff_entries`. */
export function comparisonRangeParam(comparison: Comparison): string {
  const r = comparison.selectedRange;
  return r ? `${r.baseOid}..${r.headOid}` : comparison.fullDiff.headOid;
}

/**
 * Lazy per-file diff contents. On large PRs (`linesChangedLimitExceeded`)
 * the payload only inlines the first few files; GitHub's app fetches the
 * rest per-path from this endpoint as they scroll into view.
 */
export async function fetchDiffEntries(
  pr: { owner: string; repo: string; number: number },
  range: string,
  paths: string[],
): Promise<DiffContent[]> {
  const params = new URLSearchParams({
    paths: paths.join(','),
    ctx: Array(paths.length).fill('').join(':'),
    w: '0',
    range,
  });
  const res = await fetch(
    `/${pr.owner}/${pr.repo}/pull/${pr.number}/page_data/diff_entries?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  );
  if (!res.ok) return [];
  return res.json();
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
