import { expect, test } from "vitest";
import {
  base64ToBytes,
  decodeBlobId,
  encodeBlobId,
  readGitHubBlob,
} from "./blob.js";
import { createGitHubClient } from "./client.js";

// GitHub's git/blobs response wraps base64 with a newline every so many columns; a naive atob(content)
// call throws on that in strict decoders, which would break every blob read.
test("decodes newline-wrapped base64, as GitHub's blob content arrives, to the exact original bytes", () => {
  const original = new TextEncoder().encode("hello github blob\n".repeat(10));
  let plain = "";
  for (const byte of original) plain += String.fromCharCode(byte);
  const wrapped = btoa(plain).replace(/(.{20})/g, "$1\n");

  expect(base64ToBytes(wrapped)).toEqual(original);
});

test("readGitHubBlob fetches the repo/sha an encoded BlobId names and decodes its content", async () => {
  const original = new TextEncoder().encode("const x = 1;\n");
  let plain = "";
  for (const byte of original) plain += String.fromCharCode(byte);
  const content = btoa(plain).replace(/(.{4})/g, "$1\n");

  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      expect(String(url)).toContain("/repos/RanolP/hihyou/git/blobs/deadbeef");
      return new Response(JSON.stringify({ content, encoding: "base64" }), {
        status: 200,
      });
    },
  });

  const bytes = await readGitHubBlob(
    client,
    encodeBlobId("RanolP", "hihyou", "deadbeef"),
  );
  expect(bytes).toEqual(original);
});

test("decodeBlobId round-trips owner, repo and sha through encodeBlobId", () => {
  expect(decodeBlobId(encodeBlobId("RanolP", "hihyou", "abc123"))).toEqual({
    owner: "RanolP",
    repo: "hihyou",
    sha: "abc123",
  });
});
