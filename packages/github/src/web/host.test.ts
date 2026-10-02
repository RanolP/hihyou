import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { githubWebHost } from "./host.js";

// Recorded once, logged out, from https://github.com/vitejs/vite/pull/21626 at its head 0f3f23b8: the `.diff`
// trimmed to a modified file, a rename and an added file; the raw head contents of those three; the Commits
// tab's JSON trimmed to its first and last commit, the channel's signature dropped.
const head = "0f3f23b8765df6f7bb90108955fa3b2da61cc558";
const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const raw = (path: string) => fixture(`raw/${path.replaceAll("/", "_")}.txt`);
const repo = "https://github.com/vitejs/vite";

function stubFetch(
  override: (url: string) => Uint8Array | undefined = () => undefined,
) {
  const calls: string[] = [];
  const fetch = async (url: string, init?: { accept?: string }) => {
    calls.push(url);
    const body = override(url);
    if (body) return new Response(body);
    if (url === `${repo}/pull/21626.diff`)
      return new Response(fixture("pull_21626.diff"));
    if (
      url === `${repo}/pull/21626/commits` &&
      init?.accept === "application/json"
    )
      return new Response(fixture("commits_21626.json"));
    const prefix = `${repo}/raw/${head}/`;
    if (url.startsWith(prefix))
      return new Response(raw(decodeURIComponent(url.slice(prefix.length))));
    return new Response("not recorded", {
      status: 404,
      statusText: "Not Found",
    });
  };
  return { fetch, calls };
}

const pull = { owner: "vitejs", repo: "vite", pull: 21626, head };

// If renames, additions or blob ids were read off the `.diff` wrongly, the file list would show a rename as a
// delete plus an add, or two diffsets would share a cache entry for different contents.
test("resolveDiffset lists the .diff's files with their renames, additions and content-addressed ids", async () => {
  const host = githubWebHost({ fetch: stubFetch().fetch });
  const { id, changes } = await host.resolveDiffset(pull);
  expect(id).toBe(`vitejs/vite#21626@${head}`);
  expect(changes).toEqual([
    {
      path: "packages/vite/rolldown.config.ts",
      before: "vitejs/vite@7e4f0be4a7104c",
      after: "vitejs/vite@1598d813a5f831",
    },
    {
      path: "packages/vite/src/shared/bundledDevHmr.ts",
      oldPath: "packages/vite/src/client/bundledDevHmrClient.ts",
      before: "vitejs/vite@e75e603b7a5d6f",
      after: "vitejs/vite@a4ae00a9d68d54",
    },
    {
      path: "playground/ssr-bundled-dev/package.json",
      before: null,
      after: "vitejs/vite@232de8fe81bf28",
    },
  ]);
});

// The before side has no source on github.com without the API; if undoing the hunks went wrong, the reviewer
// would see a diff GitHub never had. readBlob checks the rebuilt bytes' git blob id against the `index` line,
// so resolving at all proves the rebuild is byte-exact.
test("the before side is rebuilt byte-exact from the head file and the diff, for a modified and a renamed file", async () => {
  const host = githubWebHost({ fetch: stubFetch().fetch });
  const { changes } = await host.resolveDiffset(pull);
  for (const change of changes.filter((c) => c.before)) {
    const before = new TextDecoder().decode(
      await host.readBlob(change.before as string),
    );
    const after = new TextDecoder().decode(
      await host.readBlob(change.after as string),
    );
    expect(before).not.toBe(after);
  }
});

// The PR can move between fetching its `.diff` and its raw files; without the check, a raw file from a newer
// push would be diffed against hunks it does not match and show lines nobody wrote.
test("a raw file from another revision than the diff throws instead of showing a wrong diff", async () => {
  const { fetch } = stubFetch((url) =>
    url.endsWith("/playground/ssr-bundled-dev/package.json")
      ? new TextEncoder().encode("{}\n")
      : undefined,
  );
  const host = githubWebHost({ fetch });
  const { changes } = await host.resolveDiffset(pull);
  await expect(host.readBlob(changes[2]?.after as string)).rejects.toThrow(
    /does not match the diff's 232de8fe81bf28/,
  );
});

// Both sides of a modified file come from one raw fetch; fetching twice doubles the requests a large PR makes.
test("both sides of a modified file share one raw fetch", async () => {
  const { fetch, calls } = stubFetch();
  const host = githubWebHost({ fetch });
  const [change] = (await host.resolveDiffset(pull)).changes;
  await Promise.all([
    host.readBlob(change?.before as string),
    host.readBlob(change?.after as string),
  ]);
  expect(calls.filter((u) => u.includes("/raw/"))).toHaveLength(1);
});

// The Commits tab lists by date, so its last row is not always the head; the head names which `.diff` to fetch.
test("resolvePull takes the head from the page's channel and lists commits oldest first", async () => {
  const host = githubWebHost({ fetch: stubFetch().fetch });
  const result = await host.resolvePull("vitejs", "vite", 21626);
  expect(result.head).toBe(head);
  expect(result.commits[0]).toEqual({
    sha: "a6026e42f35f2b25bd4f1bbf0da563d65bda83ab",
    subject: "feat: support ful bundle mode in ssr",
    author: "Vladimir Sheremet",
    date: "2026-02-12T12:06:25.000+01:00",
  });
});
