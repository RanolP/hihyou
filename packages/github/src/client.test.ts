import { expect, test } from "vitest";
import { createGitHubClient } from "./client.js";

// A caller debugging a failed request needs the status and body without re-running it by hand.
test("a non-2xx response throws an Error naming the method, URL, status and body", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async () =>
      new Response("not found here", { status: 404, statusText: "Not Found" }),
  });

  await expect(client.get("/repos/o/r/pulls/1")).rejects.toThrow(
    /GET https:\/\/api\.github\.com\/repos\/o\/r\/pulls\/1 -> 404 Not Found: not found here/,
  );
});
