import type { ChangedFileRef } from "@hihyou/engine";
import type { GitHubClient } from "./client.js";
import { encodeBlobId } from "./blob.js";

/** The host's own `SerializedDiffsetId`: what a GitHub-backed diffset is named by, per `docs/design/review-core.md`. */
export interface GitHubDiffsetId {
  owner: string;
  repo: string;
  base: string; // sha
  head: string; // sha
  /** All parents when head is a merge commit; used by the REST host's --cc fallback. */
  parents?: string[];
}

export interface DiffsetResolution {
  id: string;
  changes: ChangedFileRef[];
}

/** Deterministic: same fields, same string, so the engine's cache and `Diffset.id` agree across calls. */
export function diffsetIdOf(data: GitHubDiffsetId): string {
  return `${data.owner}/${data.repo}@${data.base}..${data.head}`;
}

interface CompareFile {
  sha: string;
  filename: string;
  previous_filename?: string;
  status:
    | "added"
    | "removed"
    | "modified"
    | "renamed"
    | "copied"
    | "changed"
    | "unchanged";
  /** The file's unified diff hunks; GitHub leaves it out for a binary or very large file. */
  patch?: string;
}

interface CompareResponse {
  merge_base_commit: { sha: string };
  files?: CompareFile[];
}

/** GitHub's own limits on `compare`: it paginates `files` and hard-caps the total at 3000. */
export const compareFilesPerPage = 100;
export const maxCompareFiles = 3000;

export async function fetchCompareFiles(
  client: GitHubClient,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<{ mergeBaseSha: string; files: CompareFile[] }> {
  const basehead = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  let mergeBaseSha: string | undefined;
  const files: CompareFile[] = [];
  for (let page = 1; ; page++) {
    const data = await client.get<CompareResponse>(
      `/repos/${owner}/${repo}/compare/${basehead}`,
      { per_page: compareFilesPerPage, page },
    );
    mergeBaseSha ??= data.merge_base_commit.sha;
    const pageFiles = data.files ?? [];
    files.push(...pageFiles);
    // GitHub itself hard-caps a compare at maxCompareFiles; without this check, a diff that size never
    // returns a page shorter than per_page and the loop above would fetch forever.
    if (files.length >= maxCompareFiles) {
      throw new Error(
        `GitHub's compare API caps a diff at ${maxCompareFiles} files; ` +
          `${owner}/${repo} ${base}...${head} hit the cap, so the file list may be incomplete`,
      );
    }
    if (pageFiles.length < compareFilesPerPage) break;
  }
  if (!mergeBaseSha) {
    throw new Error(
      `GitHub compare of ${owner}/${repo} ${base}...${head} returned no merge_base_commit`,
    );
  }
  return { mergeBaseSha, files };
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

interface TreeResponse {
  tree: TreeEntry[];
  truncated: boolean;
}

type BeforeLookup = (path: string) => Promise<string | undefined>;

/**
 * The before-side blob SHA per path, read from the merge-base tree GitHub's compare already used. A
 * truncated tree (very large repos) falls back to one `contents` request per path actually needed. The
 * tree itself is fetched lazily, on first use, so an all-added or all-removed diffset never needs it.
 */
function createBeforeLookup(
  client: GitHubClient,
  owner: string,
  repo: string,
  mergeBaseSha: string,
): BeforeLookup {
  let tree:
    | Promise<{ known: Map<string, string>; truncated: boolean }>
    | undefined;
  const loadTree = () =>
    (tree ??= client
      .get<TreeResponse>(
        `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(mergeBaseSha)}`,
        {
          recursive: 1,
        },
      )
      .then((data) => ({
        known: new Map(
          data.tree
            .filter((entry) => entry.type === "blob")
            .map((entry) => [entry.path, entry.sha]),
        ),
        truncated: data.truncated === true,
      })));

  return async (path: string): Promise<string | undefined> => {
    const { known, truncated } = await loadTree();
    const sha = known.get(path);
    if (sha !== undefined) return sha;
    if (!truncated) return undefined;
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const contents = await client.get<{ sha: string } | unknown[]>(
      `/repos/${owner}/${repo}/contents/${encodedPath}`,
      { ref: mergeBaseSha },
    );
    if (Array.isArray(contents)) return undefined; // a directory, not a file: no blob to read
    known.set(path, contents.sha);
    return contents.sha;
  };
}

async function toChangedFileRef(
  owner: string,
  repo: string,
  file: CompareFile,
  lookup: BeforeLookup,
): Promise<ChangedFileRef> {
  if (file.status === "added") {
    return {
      path: file.filename,
      before: null,
      after: encodeBlobId(owner, repo, file.sha),
    };
  }
  // GitHub reports a removed file's own (base-side) blob SHA in `sha`, since no after-side blob exists.
  if (file.status === "removed") {
    return {
      path: file.filename,
      before: encodeBlobId(owner, repo, file.sha),
      after: null,
    };
  }
  const oldPath = file.previous_filename;
  const beforeSha = await lookup(oldPath ?? file.filename);
  if (beforeSha === undefined) {
    throw new Error(
      `GitHub's merge-base tree for ${owner}/${repo} has no blob at "${oldPath ?? file.filename}", ` +
        `needed for the before side of "${file.filename}" (status ${file.status})`,
    );
  }
  return {
    path: file.filename,
    ...(oldPath !== undefined && { oldPath }),
    before: encodeBlobId(owner, repo, beforeSha),
    after: encodeBlobId(owner, repo, file.sha),
  };
}

export async function resolveGitHubDiffset(
  client: GitHubClient,
  data: GitHubDiffsetId,
): Promise<DiffsetResolution> {
  const { owner, repo, base, head } = data;
  const [first, others] = await Promise.all([
    fetchCompareFiles(client, owner, repo, base, head),
    Promise.all(
      (data.parents ?? [])
        .slice(1)
        .map((parent) => fetchCompareFiles(client, owner, repo, parent, head)),
    ),
  ]);
  const changedByEveryParent = others.map(
    ({ files }) => new Set(files.map((file) => file.filename)),
  );
  const files = first.files.filter((file) =>
    changedByEveryParent.every((paths) => paths.has(file.filename)),
  );
  const { mergeBaseSha } = first;
  const lookup = createBeforeLookup(client, owner, repo, mergeBaseSha);
  const changes = await Promise.all(
    files.map((file) => toChangedFileRef(owner, repo, file, lookup)),
  );
  return { id: diffsetIdOf(data), changes };
}
