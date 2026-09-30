import type { BlobId } from "@hihyou/engine";
import type { GitHubClient } from "./client.js";

/** A `BlobId` is host-issued and opaque; ours packs the repo in so `readBlob(id)` alone can fetch it. */
export function encodeBlobId(owner: string, repo: string, sha: string): BlobId {
  return `${owner}/${repo}@${sha}`;
}

export function decodeBlobId(id: BlobId): {
  owner: string;
  repo: string;
  sha: string;
} {
  const at = id.lastIndexOf("@");
  const slash = id.indexOf("/");
  if (at < 0 || slash < 0 || slash > at) {
    throw new Error(`not a github blob id: ${id}`);
  }
  return {
    owner: id.slice(0, slash),
    repo: id.slice(slash + 1, at),
    sha: id.slice(at + 1),
  };
}

interface BlobResponse {
  content: string;
  encoding: string;
}

export async function readGitHubBlob(
  client: GitHubClient,
  id: BlobId,
): Promise<Uint8Array> {
  const { owner, repo, sha } = decodeBlobId(id);
  const blob = await client.get<BlobResponse>(
    `/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`,
  );
  if (blob.encoding !== "base64") {
    throw new Error(`unexpected blob encoding "${blob.encoding}" for ${id}`);
  }
  return base64ToBytes(blob.content);
}

/** `atob`-based, so it runs in a browser; GitHub wraps blob content at 60-ish columns, hence the strip. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
