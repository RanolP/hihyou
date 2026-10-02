import { expect, test } from "vitest";
import { createGitHubClient } from "./client.js";
import {
  listPullRequestCommits,
  listPullRequests,
  resolvePullRequest,
} from "./pulls.js";

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

// Catches a PR commit whose first parent is dropped, which would leave its per-commit diffset without a base.
test("listPullRequestCommits reads each commit's first parent, subject and author", async () => {
  const client = createGitHubClient({
    token: "t",
    fetch: async (url) => {
      expect(new URL(String(url)).pathname).toBe("/repos/o/r/pulls/7/commits");
      return jsonResponse([
        {
          sha: "c1",
          parents: [{ sha: "p1" }, { sha: "p2" }],
          commit: {
            message: "feat: a\n\nbody",
            author: { name: "Ann", date: "2026-01-01T00:00:00Z" },
          },
        },
      ]);
    },
  });

  expect(await listPullRequestCommits(client, "o", "r", 7)).toEqual([
    {
      sha: "c1",
      parent: "p1",
      message: "feat: a\n\nbody",
      author: "Ann",
      date: "2026-01-01T00:00:00Z",
    },
  ]);
});
