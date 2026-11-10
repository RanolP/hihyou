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

interface DiffSummary {
  path?: unknown;
  markedAsViewed?: unknown;
}

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
  const url = `${base}/changes`;
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      // A signed-out reader is sent on to /files; following it would only fetch HTML to throw away.
      redirect: "manual",
      headers: { ...verifiedHeaders(), "X-GitHub-App-Type": "dataRouter" },
    });
  } catch (error) {
    console.warn(`hihyou: GitHub viewed files unavailable (GET ${url})`, error);
    return undefined;
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("json")) {
    // The expected answer for a signed-out reader, so it stays at debug level.
    console.debug(
      `hihyou: GitHub viewed files not synced (GET ${url}: ${response.type} ${response.status} ${type})`,
    );
    return undefined;
  }
  let summaries: unknown;
  let pathName: unknown;
  try {
    const body = (await response.json()) as {
      payload?: {
        pullRequestsChangesRoute?: {
          diffSummaries?: unknown;
          pullRequest?: { pathName?: unknown };
        };
      };
    };
    const route = body.payload?.pullRequestsChangesRoute;
    summaries = route?.diffSummaries;
    pathName = route?.pullRequest?.pathName;
  } catch (error) {
    console.warn(`hihyou: GitHub viewed files unreadable (GET ${url})`, error);
    return undefined;
  }
  if (!Array.isArray(summaries)) {
    console.warn(
      `hihyou: GitHub viewed files missing from GET ${url}: payload.pullRequestsChangesRoute.diffSummaries is ${typeof summaries}`,
    );
    return undefined;
  }
  const paths = new Set<string>();
  const viewed = new Set<string>();
  for (const summary of summaries as DiffSummary[]) {
    if (typeof summary?.path !== "string") continue;
    paths.add(summary.path);
    if (summary.markedAsViewed === true) viewed.add(summary.path);
  }
  const reviewUrl = `${typeof pathName === "string" && pathName.startsWith("/") ? pathName : base}/file_review`;
  return {
    paths,
    viewed,
    async set(path, on) {
      const method = on ? "POST" : "DELETE";
      const response = await fetch(reviewUrl, {
        method,
        credentials: "same-origin",
        headers: { ...verifiedHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(
          on ? { path, viewed: "viewed" } : { path, _method: "delete" },
        ),
      });
      if (!response.ok)
        throw new Error(
          `${method} ${reviewUrl} for ${path}: ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`,
        );
    },
  };
}
