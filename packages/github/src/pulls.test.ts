import { expect, test } from "vitest";
import { createGitHubClient } from "./client.js";
import { listPullRequests, resolvePullRequest } from "./pulls.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

test("resolvePullRequest reads number, title and both sides' sha off /pulls/:number", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      expect(String(url)).toContain("/repos/o/r/pulls/42");
      return jsonResponse({
        number: 42,
        title: "fix: thing",
        base: { sha: "base-sha" },
        head: { sha: "head-sha" },
      });
    },
  });

  expect(await resolvePullRequest(client, "o", "r", 42)).toEqual({
    number: 42,
    title: "fix: thing",
    base: "base-sha",
    head: "head-sha",
  });
});

test("listPullRequests asks for open PRs on the first page", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      const u = new URL(String(url));
      expect(u.pathname).toBe("/repos/o/r/pulls");
      expect(u.searchParams.get("state")).toBe("open");
      return jsonResponse([
        { number: 1, title: "a", base: { sha: "b1" }, head: { sha: "h1" } },
        { number: 2, title: "b", base: { sha: "b2" }, head: { sha: "h2" } },
      ]);
    },
  });

  expect(await listPullRequests(client, "o", "r")).toEqual([
    { number: 1, title: "a", base: "b1", head: "h1" },
    { number: 2, title: "b", base: "b2", head: "h2" },
  ]);
});
