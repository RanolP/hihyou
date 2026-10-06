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

/**
 * What a diffset is named by when the host reads github.com pages with the browser's own session instead of the
 * REST API: a pull request's whole change at one head commit, or one commit against its first parent.
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

export interface GitHubWebHostOptions {
  /**
   * Fetches a github.com URL with the signed-in browser session, following redirects. A content script cannot
   * read `pull/<n>.diff` itself (it redirects to patch-diff.githubusercontent.com, which sends no CORS headers),
   * so the browser extension passes one that goes through its background worker.
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
  resolvePull(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubWebPull>;
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
 * - a file's after side: `raw/<commit>/<path>`;
 * - its before side: the after side with the diff's hunks undone. github.com serves no merge base without the
 *   API, and undoing the hunks needs none; every context line is checked, so a mismatch throws.
 *
 * A `BlobId` is the `index` line's abbreviated blob id, so it is content-addressed as the contract asks; a file
 * with no `index` line (a pure rename) is named by its commit and path, the same id on both sides.
 */
export function githubWebHost(options: GitHubWebHostOptions): GitHubWebHost {
  const origin = options.origin ?? "https://github.com";
  /** How to produce each blob id resolveDiffset has handed out. */
  const recipes = new Map<BlobId, () => Promise<Uint8Array>>();

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

  const resolveDiffset = async (
    data: GitHubWebDiffsetId,
  ): Promise<DiffsetResolution> => {
    const { owner, repo } = data;
    const commit = "pull" in data ? data.head : data.commit;
    const url =
      "pull" in data
        ? `${repoUrl(owner, repo)}/pull/${data.pull}.diff`
        : `${repoUrl(owner, repo)}/commit/${encodeURIComponent(data.commit)}.diff`;
    const patches = parseDiff(await (await get(url)).text());
    const changes = patches.map((patch) =>
      toChange(
        patch,
        `${owner}/${repo}@`,
        commit,
        rawUrl(repoUrl(owner, repo), commit, patch.newPath),
        url,
      ),
    );
    return { id: webDiffsetIdOf(data), changes };
  };

  const rawUrl = (repoBase: string, commit: string, path: string) =>
    `${repoBase}/raw/${encodeURIComponent(commit)}/${path.split("/").map(encodeURIComponent).join("/")}`;

  const toChange = (
    patch: FilePatch,
    prefix: string,
    commit: string,
    raw: string,
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
            : get(raw).then(
                async (r) => new Uint8Array(await r.arrayBuffer()),
              ));
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
      ...(kind && { kind }),
    };
  };

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
      const head =
        headFromChannel(route.metadata?.commitHeadShaChannel) ??
        commits.at(-1)?.sha;
      if (!head) throw new Error(`GET ${url} listed no commits`);
      return { head, commits };
    },
    ...(options.preferences && { preferences: options.preferences }),
  };
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
