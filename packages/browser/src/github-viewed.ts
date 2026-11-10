/**
 * GitHub's own per-file "Viewed" checkbox, read and written the way github.com's React "changes" page does it:
 * same-origin requests on the reader's session, with the headers its `verifiedFetch` sends in place of a form's
 * authenticity token. A signed-out reader gets a redirect for the read, so the sync stays off and hihyou's viewed
 * state stays local.
 */

export interface GitHubViewed {
  /** Every path the pull request changes, as GitHub lists it. */
  readonly paths: ReadonlySet<string>;
  /** The paths the signed-in reader marked viewed and has not changed since. */
  readonly viewed: ReadonlySet<string>;
  /** Marks `path` viewed on GitHub, or clears the mark; rejects with the status on failure. */
  set(path: string, viewed: boolean): Promise<void>;
}

const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

/** The headers github.com's `verifiedFetch` adds; the nonce and release come from the page it serves. */
const verifiedHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "GitHub-Verified-Fetch": "true",
    "GitHub-Is-React": "true",
    "X-Requested-With": "XMLHttpRequest",
  };
  const nonce = meta("fetch-nonce");
  if (nonce) headers["X-Fetch-Nonce"] = nonce;
  const release = meta("release");
  if (release) headers["X-GitHub-Client-Version"] = release;
  return headers;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Reads the reader's viewed files for one pull request; `undefined` when GitHub keeps no such state for them
 * (signed out, or a response this code does not know), which leaves hihyou local-only.
 */
export async function loadGitHubViewed(
  owner: string,
  repo: string,
  pull: number,
): Promise<GitHubViewed | undefined> {
  const base = `/${owner}/${repo}/pull/${pull}`;
  const url = new URL(`${base}/changes`, location.origin).href;
  const response = await fetch(url, {
    credentials: "same-origin",
    // A signed-out reader is sent on to /files; following it would only fetch HTML to throw away.
    redirect: "manual",
    headers: { ...verifiedHeaders(), "X-GitHub-App-Type": "dataRouter" },
  }).catch((error: unknown) => {
    console.warn(`hihyou: GitHub viewed files unavailable (GET ${url})`, error);
    return undefined;
  });
  if (!response) return undefined;
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("json")) {
    // The expected answer for a signed-out reader, so it stays at debug level.
    console.debug(
      `hihyou: GitHub viewed files not synced (GET ${url}: ${response.type} ${response.status} ${type})`,
    );
    return undefined;
  }
  // JSON never parses to `undefined`, so it marks a body that failed to parse.
  const body: unknown = await response.json().catch((error: unknown) => {
    console.warn(`hihyou: GitHub viewed files unreadable (GET ${url})`, error);
    return undefined;
  });
  if (body === undefined) return undefined;
  const payload = isRecord(body) ? body["payload"] : undefined;
  const route = isRecord(payload)
    ? payload["pullRequestsChangesRoute"]
    : undefined;
  const summaries = isRecord(route) ? route["diffSummaries"] : undefined;
  const pullRequest = isRecord(route) ? route["pullRequest"] : undefined;
  const pathName = isRecord(pullRequest) ? pullRequest["pathName"] : undefined;
  if (!Array.isArray(summaries)) {
    console.warn(
      `hihyou: GitHub viewed files missing from GET ${url}: payload.pullRequestsChangesRoute.diffSummaries is ${typeof summaries}`,
    );
    return undefined;
  }
  const list: readonly unknown[] = summaries;
  const paths = new Set<string>();
  const viewed = new Set<string>();
  for (const summary of list) {
    if (!isRecord(summary)) continue;
    const path = summary["path"];
    if (typeof path !== "string") continue;
    paths.add(path);
    if (summary["markedAsViewed"] === true) viewed.add(path);
  }
  // Only a path inside this repository: the writes go wherever it points.
  const reviewBase =
    typeof pathName === "string" && pathName.startsWith(`/${owner}/${repo}/`)
      ? pathName
      : base;
  const reviewUrl = new URL(`${reviewBase}/file_review`, location.origin).href;
  return {
    paths,
    viewed,
    async set(path, on) {
      const method = on ? "POST" : "DELETE";
      const response = await fetch(reviewUrl, {
        method,
        credentials: "same-origin",
        // A signed-out reader is redirected to the login page; followed, its 200 would read as success.
        redirect: "manual",
        headers: { ...verifiedHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(
          on ? { path, viewed: "viewed" } : { path, _method: "delete" },
        ),
      });
      if (!response.ok || response.type === "opaqueredirect")
        throw new Error(
          `${method} ${reviewUrl} for ${path}: ${response.type} ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`,
        );
    },
  };
}
