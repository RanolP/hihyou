import { syntechsGrammars } from "@hihyou/engine";
import type {
  BlobId,
  ChangedFileRef,
  GrammarLoader,
  Host,
  HostPreferences,
} from "@hihyou/engine";
import type { DiffsetResolution } from "../diffset.js";
import { type FilePatch, parseDiff, reverseApply } from "./patch.js";

// The subjects git's fmt-merge-msg writes (branch, tag, commit, remote-tracking, a bare pulled URL), GitHub's merge button, and stacking tools' unquoted `Merge <ref> into <ref>`.
export const GENERATED_MERGE_SUBJECT =
  /^Merge (?:(?:remote-tracking )?branch(?:es)? '|tags? '|commits? '|pull request #\d+ from |(?:(?:[a-z][\w+.-]*:\/\/|[\w.-]+(?:@[\w.-]+)?:|\/)\S+|\S+ into \S+)$)/;

/**
 * What a diffset is named by when the host reads github.com pages with the browser's own session instead of the
 * REST API: a pull request's whole change at one head commit, or one commit selected inside that pull request.
 */
export type GitHubWebDiffsetId =
  | { owner: string; repo: string; pull: number; head: string }
  | { owner: string; repo: string; commit: string };

export interface GitHubWebCommit {
  sha: string;
  /** The first line of the message. */
  subject: string;
  author: string;
  /** ISO 8601, as github.com reports the author date. */
  date: string;
}

export interface GitHubWebPull {
  /** The commit the pull request's `.diff` is taken at. */
  head: string;
  /** Oldest first, as the pull request's Commits tab lists them. */
  commits: GitHubWebCommit[];
}

export interface GitHubWebReviewThread {
  path: string;
  before?: number;
  after?: number;
  /** Unknown when the public review-comments REST API supplied the thread. */
  resolved?: boolean;
  comments: {
    author: string;
    avatarUrl?: string;
    createdAt?: string;
    body: string;
    bodyHtml?: string;
  }[];
}

interface PullReviewComment {
  id: number;
  in_reply_to_id?: number;
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT" | null;
  original_line: number | null;
  user: { login: string; avatar_url?: string } | null;
  created_at?: string;
  body: string;
  body_html?: string;
}

function isPullReviewComment(value: unknown): value is PullReviewComment {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    (!("in_reply_to_id" in value) ||
      typeof value.in_reply_to_id === "number") &&
    "path" in value &&
    typeof value.path === "string" &&
    "line" in value &&
    (typeof value.line === "number" || value.line === null) &&
    "side" in value &&
    (value.side === "LEFT" || value.side === "RIGHT" || value.side === null) &&
    "original_line" in value &&
    (typeof value.original_line === "number" || value.original_line === null) &&
    "user" in value &&
    (value.user === null ||
      (typeof value.user === "object" &&
        "login" in value.user &&
        typeof value.user.login === "string" &&
        (!("avatar_url" in value.user) ||
          typeof value.user.avatar_url === "string"))) &&
    (!("created_at" in value) || typeof value.created_at === "string") &&
    "body" in value &&
    typeof value.body === "string" &&
    (!("body_html" in value) || typeof value.body_html === "string")
  );
}

export interface GitHubWebHostOptions {
  /**
   * Fetches an allowed GitHub URL with the browser session, following redirects. A content script cannot
   * read `pull/<n>.diff` itself (it redirects to patch-diff.githubusercontent.com, which sends no CORS headers),
   * so the browser extension passes one that goes through its background worker. With the default origin it is
   * also handed patch-diff.githubusercontent.com and raw.githubusercontent.com URLs directly.
   */
  fetch: (url: string, init?: { accept?: string }) => Promise<Response>;
  /** Defaults to `syntechsGrammars()` with default formatting for each supported language. */
  grammars?: GrammarLoader;
  preferences?: HostPreferences;
  /** Defaults to https://github.com. */
  origin?: string;
}

export interface GitHubWebHost extends Host {
  resolveDiffset(data: GitHubWebDiffsetId): Promise<DiffsetResolution>;
  resolvePullBody(owner: string, repo: string, number: number): Promise<string>;
  resolveReviewThreads(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubWebReviewThread[]>;
  resolvePull(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubWebPull>;
  /**
   * Starts fetching the pull request's `.diff` before its head is known, for the next `resolveDiffset` of that pull
   * request to take. The URL names no head; a head that moved in between fails the blob id check on the raw files.
   */
  prefetchPullDiff(owner: string, repo: string, number: number): void;
}

/** Deterministic: same fields, same string, so the engine's cache and `Diffset.id` agree across calls. */
export function webDiffsetIdOf(data: GitHubWebDiffsetId): string {
  return "pull" in data
    ? `${data.owner}/${data.repo}#${data.pull}@${data.head}`
    : `${data.owner}/${data.repo}@${data.commit}`;
}

interface CommitsRoute {
  payload?: {
    pullRequestsCommitsRoute?: {
      commitGroups: {
        commits: {
          oid: string;
          shortMessage: string;
          authoredDate: string;
          authors?: { login?: string; displayName?: string }[];
        }[];
      }[];
      metadata?: { commitHeadShaChannel?: string };
    };
  };
}

/**
 * A `Host` over github.com's own pages, for a browser extension running where the user is already signed in:
 * no token, no api.github.com.
 *
 * - a pull request's commits and head: `pull/<n>/commits` asked for JSON, the route GitHub's own page uses;
 * - which files changed, renames, binaries and blob ids: `pull/<n>.diff` or `commit/<sha>.diff`;
 * - which of a merge commit's files GitHub shows: its `pull/<n>/commits/<sha>` page, see `mergeFilesShown`;
 * - a file's after side: `raw/<commit>/<path>`;
 * - its before side: the after side with the diff's hunks undone. github.com serves no merge base without the
 *   API, and undoing the hunks needs none; every context line is checked, so a mismatch throws.
 *
 * A `BlobId` is the `index` line's abbreviated blob id, so it is content-addressed as the contract asks; a file
 * with no `index` line (a pure rename) is named by its commit and path, the same id on both sides.
 */
export function githubWebHost(options: GitHubWebHostOptions): GitHubWebHost {
  const origin = options.origin ?? "https://github.com";
  /** Commits `resolvePull` listed, by `webDiffsetIdOf`: their pull request and whether they look like a merge. */
  const listed = new Map<string, { pull: number; merge: boolean }>();
  /** How to produce each blob id resolveDiffset has handed out. */
  const recipes = new Map<BlobId, () => Promise<Uint8Array>>();
  /** `pull/<n>.diff` texts `prefetchPullDiff` started, by `owner/repo#n`; the next `resolveDiffset` takes each once. */
  const prefetched = new Map<string, Promise<string>>();
  const pullDiffUrl = (owner: string, repo: string, number: number) =>
    `${repoUrl(owner, repo)}/pull/${number}.diff`;
  /**
   * github.com answers `pull/<n>.diff` and `raw/...` with a redirect to these hosts, a hop of about 200 ms; asking
   * them first skips it. A private pull request's patch-diff URL redirects back to github.com, which the fetch
   * follows with the session; a private raw file is a 404 there, so its repo goes through github.com from then on.
   */
  const direct = origin === "https://github.com";
  const viaOrigin = new Set<string>();
  const directPullDiffUrl = (owner: string, repo: string, number: number) =>
    `https://patch-diff.githubusercontent.com/raw/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${number}.diff`;
  const directRawUrl = (
    owner: string,
    repo: string,
    commit: string,
    path: string,
  ) =>
    `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commit)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  /** `directUrl` first, unless `repo` failed there before; any failure retries `url`, whose error reads as before. */
  const getDirect = async (
    repo: string,
    directUrl: string,
    url: string,
  ): Promise<Response> => {
    if (!direct || viaOrigin.has(repo)) return get(url);
    try {
      return await get(directUrl);
    } catch (error) {
      console.warn(`hihyou: ${directUrl} failed, using ${url} for ${repo}`, error);
      viaOrigin.add(repo);
      return get(url);
    }
  };

  const get = async (url: string, accept?: string): Promise<Response> => {
    const response = await options.fetch(
      url,
      accept === undefined ? undefined : { accept },
    );
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new Error(
        `GET ${url} -> ${response.status} ${response.statusText}: ${body}`,
      );
    }
    return response;
  };
  const repoUrl = (owner: string, repo: string) =>
    `${origin}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  /**
   * A merge commit's first-parent patches cut to the files its pull request commit page shows. A commit opened
   * outside any listed pull request keeps its first-parent diff, as GitHub's own commit page does; so does a merge
   * whose page fails to load or cannot be trusted.
   */
  const shownPatches = async (
    patches: FilePatch[],
    data: GitHubWebDiffsetId,
  ): Promise<FilePatch[]> => {
    const inPull =
      "pull" in data ? undefined : listed.get(webDiffsetIdOf(data));
    if ("pull" in data || !inPull?.merge) return patches;
    const page = `${repoUrl(data.owner, data.repo)}/pull/${inPull.pull}/commits/${encodeURIComponent(data.commit)}`;
    let shown: Set<string> | undefined;
    try {
      shown = mergeFilesShown(await (await get(page)).text(), page);
    } catch (error) {
      console.warn(
        `${page} failed to load; showing the merge against its first parent:`,
        error,
      );
    }
    // Either side may name a renamed or deleted file: no recorded page shows which one GitHub lists.
    return shown
      ? patches.filter(
          (patch) => shown.has(patch.newPath) || shown.has(patch.oldPath),
        )
      : patches;
  };

  const resolveDiffset = async (
    data: GitHubWebDiffsetId,
  ): Promise<DiffsetResolution> => {
    const { owner, repo } = data;
    const commit = "pull" in data ? data.head : data.commit;
    const url =
      "pull" in data
        ? pullDiffUrl(owner, repo, data.pull)
        : `${repoUrl(owner, repo)}/commit/${encodeURIComponent(data.commit)}.diff`;
    const key = "pull" in data ? `${owner}/${repo}#${data.pull}` : "";
    const early = prefetched.get(key);
    prefetched.delete(key);
    const fetchText = async () =>
      (
        await ("pull" in data
          ? getDirect(
              `${owner}/${repo}`,
              directPullDiffUrl(owner, repo, data.pull),
              url,
            )
          : get(url))
      ).text();
    // A failed prefetch is fetched again, so its error is the one a fetch made now would raise.
    const text = await (early?.catch(fetchText) ?? fetchText());
    const patches = await shownPatches(parseDiff(text), data);
    const changes = patches.map((patch) =>
      toChange(
        patch,
        `${owner}/${repo}@`,
        commit,
        () =>
          getDirect(
            `${owner}/${repo}`,
            directRawUrl(owner, repo, commit, patch.newPath),
            rawUrl(repoUrl(owner, repo), commit, patch.newPath),
          ),
        url,
      ),
    );
    return { id: webDiffsetIdOf(data), changes: mergeTypeChanges(changes) };
  };

  // Git writes a type change (a symlink become a file) as a deletion and an addition of one path; GitHub
  // lists it as one file, so the pair becomes one change whose sides keep their own recipes.
  const mergeTypeChanges = (changes: ChangedFileRef[]): ChangedFileRef[] => {
    const added = new Map(
      changes
        .filter((change) => change.before === null)
        .map((change) => [change.path, change]),
    );
    const merged = new Set<ChangedFileRef>();
    const out: ChangedFileRef[] = [];
    for (const change of changes) {
      if (merged.has(change)) continue;
      const pair =
        change.after === null && change.oldPath === undefined
          ? added.get(change.path)
          : undefined;
      if (!pair) {
        out.push(change);
        continue;
      }
      merged.add(pair);
      const kind = change.kind ?? pair.kind;
      out.push({
        path: change.path,
        before: change.before,
        after: pair.after,
        stats: {
          added: (change.stats?.added ?? 0) + (pair.stats?.added ?? 0),
          removed: (change.stats?.removed ?? 0) + (pair.stats?.removed ?? 0),
        },
        ...(kind && { kind }),
      });
    }
    return out;
  };

  const rawUrl = (repoBase: string, commit: string, path: string) =>
    `${repoBase}/raw/${encodeURIComponent(commit)}/${path.split("/").map(encodeURIComponent).join("/")}`;

  const toChange = (
    patch: FilePatch,
    prefix: string,
    commit: string,
    raw: () => Promise<Response>,
    diffUrl: string,
  ): ChangedFileRef => {
    const named = (blob: string | undefined) =>
      prefix + (blob ?? `${commit}:${patch.newPath}`);
    const before = patch.status === "added" ? null : named(patch.oldBlob);
    const after = patch.status === "deleted" ? null : named(patch.newBlob);
    const kind =
      patch.mode === "160000"
        ? "submodule"
        : patch.binary
          ? "binary"
          : undefined;
    if (!kind) {
      // The engine may read either side first; both share one fetch of the after side, dropped once both have it.
      let pending: Promise<Uint8Array> | undefined;
      let readers = (after ? 1 : 0) + (before && before !== after ? 1 : 0);
      const afterBytes = () => {
        const bytes = (pending ??=
          after === null
            ? Promise.resolve(new Uint8Array())
            : raw().then(async (r) => new Uint8Array(await r.arrayBuffer())));
        if (--readers <= 0) pending = undefined;
        return bytes;
      };
      if (after)
        recipes.set(after, async () =>
          checked(
            await afterBytes(),
            patch.newBlob,
            `${patch.newPath} at ${commit}`,
          ),
        );
      if (before && before !== after)
        recipes.set(before, async () => {
          const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
            await afterBytes(),
          );
          const bytes = new TextEncoder().encode(
            reverseApply(text, patch.hunks, `${patch.oldPath} (${diffUrl})`),
          );
          return checked(
            bytes,
            patch.oldBlob,
            `${patch.oldPath} rebuilt from ${diffUrl}`,
          );
        });
    }
    return {
      path: patch.newPath,
      ...(patch.oldPath !== patch.newPath && { oldPath: patch.oldPath }),
      before,
      after,
      stats: {
        added: patch.hunks.reduce(
          (n, hunk) => n + hunk.lines.filter((line) => line[0] === "+").length,
          0,
        ),
        removed: patch.hunks.reduce(
          (n, hunk) => n + hunk.lines.filter((line) => line[0] === "-").length,
          0,
        ),
      },
      ...(kind && { kind }),
    };
  };

  const reviewThreads = new Map<string, Promise<GitHubWebReviewThread[]>>();
  return {
    grammars: options.grammars ?? syntechsGrammars(),
    resolveDiffset,
    readBlob: (id) => {
      const recipe = recipes.get(id);
      if (!recipe)
        throw new Error(
          `blob ${id} was not listed by any diffset this host resolved`,
        );
      return recipe();
    },
    async resolvePull(owner, repo, number) {
      const url = `${repoUrl(owner, repo)}/pull/${number}/commits`;
      const json = (await (
        await get(url, "application/json")
      ).json()) as CommitsRoute;
      const route = json.payload?.pullRequestsCommitsRoute;
      if (!route)
        throw new Error(
          `GET ${url} returned no pullRequestsCommitsRoute payload`,
        );
      const commits = route.commitGroups.flatMap((g) =>
        g.commits.map((c) => ({
          sha: c.oid,
          subject: c.shortMessage,
          author: c.authors?.[0]?.displayName || c.authors?.[0]?.login || "",
          date: c.authoredDate,
        })),
      );
      for (const commit of commits)
        listed.set(webDiffsetIdOf({ owner, repo, commit: commit.sha }), {
          pull: number,
          // The route carries no parents; a merge renamed away from git's default subject keeps its first-parent diff.
          merge: GENERATED_MERGE_SUBJECT.test(commit.subject),
        });
      const head =
        headFromChannel(route.metadata?.commitHeadShaChannel) ??
        commits.at(-1)?.sha;
      if (!head) throw new Error(`GET ${url} listed no commits`);
      return { head, commits };
    },
    prefetchPullDiff(owner, repo, number) {
      const text = getDirect(
        `${owner}/${repo}`,
        directPullDiffUrl(owner, repo, number),
        pullDiffUrl(owner, repo, number),
      ).then((r) => r.text());
      // Unhandled until resolveDiffset takes it, and that refetches on failure.
      text.catch(() => {});
      prefetched.set(`${owner}/${repo}#${number}`, text);
    },
    async resolvePullBody(owner, repo, number) {
      const url =
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
        `/pulls/${number}`;
      const json: unknown = await (await get(url)).json();
      if (
        !json ||
        typeof json !== "object" ||
        !("body" in json) ||
        (typeof json.body !== "string" && json.body !== null)
      )
        throw new Error(`GET ${url} returned no pull request body`);
      return json.body ?? "";
    },
    resolveReviewThreads(owner, repo, number) {
      // Unauthenticated REST allows 60 requests an hour, and every diffset switch asks again.
      const key = `${owner}/${repo}#${number}`;
      const cached = reviewThreads.get(key);
      if (cached) return cached;
      const loading = fetchReviewThreads(owner, repo, number);
      reviewThreads.set(key, loading);
      loading.catch(() => reviewThreads.delete(key));
      return loading;
    },
    ...(options.preferences && { preferences: options.preferences }),
  };

  async function fetchReviewThreads(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubWebReviewThread[]> {
      let url: string | undefined =
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
        `/pulls/${number}/comments?per_page=100`;
      const comments: PullReviewComment[] = [];
      while (url) {
        const response = await get(url, "application/vnd.github.full+json");
        const json: unknown = await response.json();
        if (!Array.isArray(json))
          throw new Error("review comments response was not an array");
        comments.push(...json.filter(isPullReviewComment));
        url = nextPage(response.headers.get("link"));
      }
      return reviewThreadsFromComments(comments);
  }
}

function nextPage(link: string | null): string | undefined {
  return link
    ?.split(",")
    .map((part) => part.match(/^\s*<([^>]+)>;\s*rel="([^"]+)"/))
    .find((match) => match?.[2] === "next")?.[1];
}

function reviewThreadsFromComments(
  comments: PullReviewComment[],
): GitHubWebReviewThread[] {
  const threads: GitHubWebReviewThread[] = [];
  const byRoot = new Map<number, PullReviewComment[]>();
  for (const comment of comments) {
    const root = comment.in_reply_to_id ?? comment.id;
    const grouped = byRoot.get(root) ?? [];
    grouped.push(comment);
    byRoot.set(root, grouped);
  }
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  for (const [rootId, grouped] of byRoot) {
    const root = byId.get(rootId) ?? grouped[0];
    if (!root) continue;
    // An outdated thread has no `line`; its `original_line` numbers an older file, so, as GitHub's Files tab, skip it.
    const line = root.line ?? undefined;
    if (line === undefined || root.side === null) continue;
    threads.push({
      path: root.path,
      ...(root.side === "LEFT" ? { before: line } : { after: line }),
      comments: grouped.map((comment) => ({
        author: comment.user?.login ?? "",
        ...(comment.user?.avatar_url !== undefined && {
          avatarUrl: comment.user.avatar_url,
        }),
        ...(comment.created_at !== undefined && {
          createdAt: comment.created_at,
        }),
        body: comment.body,
        ...(comment.body_html !== undefined && {
          bodyHtml: comment.body_html,
        }),
      })),
    });
  }
  return threads;
}

interface ChangesRoute {
  payload?: {
    pullRequestsChangesWithRangeRoute?: {
      diffSummaries?: { path: string }[];
      commit?: { parents?: string[] };
      pageLimits?: { filesLimitExceeded?: boolean };
    };
  };
}

/**
 * The paths a pull request's commit page lists. For a merge commit GitHub shows its remerge diff (what the merge
 * changed beyond a clean replay of its parents), which no raw route serves: `commit/<sha>.diff` and every PR-scoped
 * `.diff` are against the first parent, so they carry every file the merged branch brought in. `undefined` keeps
 * that first-parent diff: for a commit the page says is no merge, and, with a warning, for a page that cannot be
 * trusted to list every file.
 *
 * A signed-in session is redirected to `pull/<n>/changes/<sha>`, a React page whose embedded JSON carries the
 * commit's parents, a summary per file and whether GitHub capped the file list. A logged-out one gets server-rendered
 * markup: each file header names its path in `data-tagsearch-path`, the file tree lists every path even when a diff
 * body loads later, and the extension filter's per-type counts add up to the total.
 */
export function mergeFilesShown(
  html: string,
  url: string,
): Set<string> | undefined {
  const fallBack = (why: string) => {
    console.warn(`${url} ${why}; showing the merge against its first parent`);
    return undefined;
  };
  const embedded =
    /<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1];
  const route =
    embedded === undefined
      ? undefined
      : (JSON.parse(embedded) as ChangesRoute).payload
          ?.pullRequestsChangesWithRangeRoute;
  if (route?.diffSummaries) {
    if ((route.commit?.parents?.length ?? 2) < 2) return undefined;
    if (route.pageLimits?.filesLimitExceeded)
      return fallBack("exceeds GitHub's file limit");
    return new Set(route.diffSummaries.map((summary) => summary.path));
  }
  const paths = new Set(
    [
      ...html.matchAll(/data-tagsearch-path="([^"]*)"/g),
      ...html.matchAll(
        /data-tree-entry-type="file"[^>]*>\s*<span data-filterable-item-text hidden>([^<]*)<\/span>/g,
      ),
    ].map((m) => unescapeHtml(m[1] ?? "")),
  );
  const hasFilter = html.includes("<file-filter");
  const total = [
    ...html.matchAll(/data-all-file-count-markup="\((\d+)\)"/g),
  ].reduce((sum, m) => sum + Number(m[1]), 0);
  if (!hasFilter || total !== paths.size)
    return fallBack(
      `lists ${paths.size} paths but its file filter counts ${hasFilter ? total : "none"}`,
    );
  return paths;
}

function unescapeHtml(text: string): string {
  return text.replace(
    /&(quot|#39|lt|gt|amp);/g,
    (_, name: string) =>
      ({ quot: '"', "#39": "'", lt: "<", gt: ">", amp: "&" })[name] ?? "",
  );
}

/**
 * `bytes`, once their git blob id starts with `blob` (the `index` line's abbreviation). A raw file from another
 * revision than the diff, or a before side rebuilt wrongly, throws here rather than showing a wrong diff.
 */
async function checked(
  bytes: Uint8Array,
  blob: string | undefined,
  what: string,
): Promise<Uint8Array> {
  if (blob === undefined) return bytes;
  const id = await gitBlobId(bytes);
  if (!id.startsWith(blob))
    throw new Error(
      `${what}: git blob id ${id} does not match the diff's ${blob}; the pull request may have changed while loading`,
    );
  return bytes;
}

export async function gitBlobId(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const whole = new Uint8Array(header.length + bytes.length);
  whole.set(header);
  whole.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", whole));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The head commit named by the page's live-update channel, `base64({"c":"repo:<id>:commit:<sha>"})--<hmac>`.
 * The Commits tab lists commits by date, so its last row is the head only when no commit was rebased out of order.
 */
function headFromChannel(channel: string | undefined): string | undefined {
  if (!channel) return undefined;
  try {
    const { c } = JSON.parse(atob(channel.split("--")[0] ?? "")) as {
      c?: string;
    };
    return /:commit:([0-9a-f]{40})$/.exec(c ?? "")?.[1];
  } catch {
    return undefined;
  }
}
