import {
  type Diffset,
  diffsetFromCommit,
  diffsetFromPr,
  diffsetFromRange,
  type Vcs,
} from "@hihyou/engine";
import { z } from "zod";
import type { Exec } from "./exec.js";

/** What the user asked to review; each kind converts to a Diffset. */
export type Target =
  | { kind: "commit"; rev: string }
  /** `mergeBase`: `base...head`, reviewing head against where it forked from base. */
  | { kind: "range"; base: string; head: string; mergeBase: boolean }
  | { kind: "pr"; ref: string };

export const usage = `usage:
  hihyou [<rev>]          one commit against its parent (default HEAD)
  hihyou <base>..<head>   a range
  hihyou <base>...<head>  head against its merge-base with base
  hihyou pr <number|url>  a GitHub pull request, via gh
options:
  --json                  print the ReviewDoc as JSON`;

export function parseTarget(positionals: string[]): Target {
  const [first, second, ...rest] = positionals;
  if (first === "pr") {
    if (second === undefined || rest.length > 0) throw new Error(usage);
    if (!/^(?:\d+|https?:\/\/\S+)$/.test(second))
      throw new Error(`hihyou pr: expected a PR number or URL, got ${second}`);
    return { kind: "pr", ref: second };
  }
  if (second !== undefined) throw new Error(usage);
  const rev = first ?? "HEAD";
  const range = /^(.*?)(\.\.\.?)(.*)$/.exec(rev);
  if (!range) return { kind: "commit", rev };
  const [, base, dots, head] = range;
  // As in git, an omitted side of a range means HEAD.
  return {
    kind: "range",
    base: base || "HEAD",
    head: head || "HEAD",
    mergeBase: dots === "...",
  };
}

export async function resolveTarget(
  target: Target,
  vcs: Vcs,
  exec: Exec,
): Promise<Diffset> {
  switch (target.kind) {
    case "commit":
      return diffsetFromCommit(vcs, target.rev);
    case "range":
      return target.mergeBase
        ? diffsetFromPr(vcs, target.base, target.head)
        : diffsetFromRange(vcs, target.base, target.head);
    case "pr":
      return prDiffset(target.ref, vcs, exec);
  }
}

const PullRequest = z.object({
  number: z.int(),
  url: z.url(),
  baseRefName: z.string().regex(/^[^-]/),
  baseRefOid: z.string().regex(/^[0-9a-f]+$/),
  headRefOid: z.string().regex(/^[0-9a-f]+$/),
});

/** Fetches the PR's head and base into the local repository, so both commits resolve, then reviews it as GitHub does. */
async function prDiffset(ref: string, vcs: Vcs, exec: Exec): Promise<Diffset> {
  const pr = PullRequest.parse(
    JSON.parse(
      await exec("gh", [
        "pr",
        "view",
        ref,
        "--json",
        Object.keys(PullRequest.shape).join(","),
      ]),
    ),
  );
  const repo = pr.url.replace(/\/pull\/\d+\/?$/, "");
  const remote = (await remoteFor(repo, exec)) ?? `${repo}.git`;
  await exec("git", [
    "fetch",
    "--no-tags",
    remote,
    `refs/pull/${pr.number}/head`,
    `refs/heads/${pr.baseRefName}`,
  ]);
  return diffsetFromPr(vcs, pr.baseRefOid, pr.headRefOid);
}

/** The local remote pointing at `repo`, so fetching reuses its credentials; git@host:o/r and https URLs both match. */
async function remoteFor(repo: string, exec: Exec) {
  const key = (url: string) =>
    url
      .replace(/^[a-z+]+:\/\//, "")
      .replace(/^[^@/]+@/, "")
      .replace(":", "/")
      .replace(/(?:\.git)?\/?$/, "")
      .toLowerCase();
  const want = key(repo);
  for (const line of (await exec("git", ["remote", "-v"])).split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (name && url && key(url) === want) return name;
  }
  return undefined;
}
