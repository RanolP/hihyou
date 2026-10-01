import type { ChangedFileRef } from "@hihyou/engine";
import type { Commit } from "@hihyou/git";
import {
  type OpenedPullRequest,
  githubEngine,
  githubSource,
} from "../github/command.js";
import { fixedSource, movingSource, subject } from "../local/commands.js";
import type { LocalRepo } from "../local/repos.js";
import type { ReviewSource } from "../review.js";

/** One row of the diffsets view: a change set the panel can show, and the files it changes. */
export interface Diffset {
  /** Unique across the view; also the panel's key, so a second click reveals the same panel. */
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  /** Content moves under the same row (the working tree, the index), so a save refreshes its file list. */
  moving: boolean;
  changes(): Promise<ChangedFileRef[]>;
  source: ReviewSource;
}

const branchCommitCap = 50;

/** The working tree, the index, then the current branch's commits since it left the default branch. */
export async function localDiffsets(local: LocalRepo): Promise<Diffset[]> {
  const repoKey = `local:${local.folder.uri.toString()}`;
  const moving = (kind: "worktree" | "staged", label: string): Diffset => {
    let snapshot = 0;
    return {
      key: `${repoKey}:${kind}`,
      label,
      moving: true,
      changes: async () =>
        (
          await local.engine.diffset({
            kind,
            snapshot: `tree:${++snapshot}`,
          })
        ).changes,
      source: movingSource(local, kind, `${label} · ${local.folder.name}`),
    };
  };
  const commits = (await branchCommits(local)).map((commit): Diffset => {
    const short = commit.sha.slice(0, 7);
    const id = { kind: "commit", sha: commit.sha } as const;
    return {
      key: `${repoKey}:commit:${commit.sha}`,
      label: subject(commit),
      description: short,
      tooltip: `${commit.author.replace(/\s*<.*$/, "")} · ${new Date(commit.time * 1000).toLocaleString()}\n\n${commit.message}`,
      moving: false,
      changes: async () => (await local.engine.diffset(id)).changes,
      source: fixedSource(local, id, `${short} ${subject(commit)}`),
    };
  });
  return [
    moving("worktree", "Working tree"),
    moving("staged", "Staged"),
    ...commits,
  ];
}

/** Where a branch is usually merged back to, tried in order; the first that resolves wins. */
const defaultBranches = [
  "origin/HEAD",
  "origin/main",
  "origin/master",
  "main",
  "master",
];

/**
 * HEAD's first-parent commits newest first, back to where HEAD left the default branch. On the default branch
 * itself (or with none found) nothing has left it, so the most recent commits are listed instead.
 */
async function branchCommits(local: LocalRepo): Promise<Commit[]> {
  const { repo } = local;
  const head = (await repo.head()).sha;
  if (!head) return [];
  let base: string | undefined;
  for (const ref of defaultBranches) {
    try {
      await repo.resolveRev(ref);
    } catch {
      continue;
    }
    base = await repo.mergeBase(ref, "HEAD");
    break;
  }
  if (base === head) base = undefined;
  const commits: Commit[] = [];
  for (
    let sha: string | undefined = head;
    sha && sha !== base && commits.length < branchCommitCap;
  ) {
    const commit = await repo.readCommit(sha);
    commits.push(commit);
    sha = commit.parents[0];
  }
  return commits;
}

/** The whole pull request (its base...head), then each of its commits against its first parent, newest first. */
export async function pullRequestDiffsets({
  host,
  remote,
  pr,
}: OpenedPullRequest): Promise<Diffset[]> {
  const prKey = `github:${remote.owner}/${remote.repo}#${pr.number}`;
  const diffset = (
    key: string,
    base: string,
    head: string,
    title: string,
    row: Pick<Diffset, "label" | "description" | "tooltip">,
  ): Diffset => {
    const id = { ...remote, base, head };
    return {
      key: `${prKey}:${key}`,
      ...row,
      moving: false,
      changes: async () => (await githubEngine(host).diffset(id)).changes,
      source: githubSource(host, id, title),
    };
  };
  const commits = await host.listPullRequestCommits(
    remote.owner,
    remote.repo,
    pr.number,
  );
  return [
    diffset("all", pr.base, pr.head, `#${pr.number} ${pr.title}`, {
      label: "All changes",
    }),
    // A root commit has no parent to compare against on GitHub, so it gets no row.
    ...commits.toReversed().flatMap((c) => {
      if (!c.parent) return [];
      const short = c.sha.slice(0, 7);
      return [
        diffset(
          c.sha,
          c.parent,
          c.sha,
          `#${pr.number} ${short} ${subject(c)}`,
          {
            label: subject(c),
            description: short,
            tooltip: `${c.author} · ${c.date ? new Date(c.date).toLocaleString() : ""}\n\n${c.message}`,
          },
        ),
      ];
    }),
  ];
}
