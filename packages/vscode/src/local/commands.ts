import type { Commit, LocalDiffsetId } from "@hihyou/git";
import type { DiffFile } from "@hihyou/ui";
import * as vscode from "vscode";
import { openReviewPanel } from "../panel/panel.js";
import { diffFiles, type ReviewSource } from "../review.js";
import type { LocalRepo, LocalRepos } from "./repos.js";

const recentCommitCount = 50;

type Command = () => Promise<DiffFile[] | undefined>;

export function localCommands(
  extensionUri: vscode.Uri,
  repos: LocalRepos,
): Record<string, Command> {
  const review = async (
    make: (local: LocalRepo) => Promise<ReviewSource | undefined>,
  ) => {
    const local = await repos.pick();
    const source = local && (await make(local));
    return source && openReviewPanel(extensionUri, source);
  };

  return {
    "hihyou.reviewWorkingTree": () =>
      review(async (local) =>
        movingSource(local, "worktree", `Working tree · ${local.folder.name}`),
      ),
    "hihyou.reviewStaged": () =>
      review(async (local) =>
        movingSource(local, "staged", `Staged · ${local.folder.name}`),
      ),
    "hihyou.reviewCommit": () =>
      review(async (local) => {
        const commit = await pickCommit(local);
        return (
          commit &&
          fixedSource(
            local,
            { kind: "commit", sha: commit.sha },
            `${commit.sha.slice(0, 7)} ${subject(commit)}`,
          )
        );
      }),
    "hihyou.reviewRange": () =>
      review(async (local) => {
        const ref = await pickRef(local);
        if (!ref) return undefined;
        const base = await local.repo.mergeBase(ref.name, "HEAD");
        if (!base) throw new Error(`${ref.short} shares no history with HEAD`);
        return fixedSource(
          local,
          { kind: "range", base, head: ref.name },
          `${ref.short} since ${base.slice(0, 7)}`,
        );
      }),
  };
}

/** The working tree or the index: read again on every load, under a new snapshot token. */
export function movingSource(
  local: LocalRepo,
  kind: "worktree" | "staged",
  title: string,
): ReviewSource {
  let snapshot = 0;
  return {
    title,
    load: () => diffFiles(local.engine, { kind, snapshot: String(++snapshot) }),
    readBlob: async (id) => local.host.readBlob(id),
    refreshable: true,
    refreshOnSave: kind === "worktree",
  };
}

export function fixedSource(
  local: LocalRepo,
  id: LocalDiffsetId,
  title: string,
): ReviewSource {
  return {
    title,
    load: () => diffFiles(local.engine, id),
    readBlob: async (blob) => local.host.readBlob(blob),
    refreshable: false,
  };
}

export const subject = (c: { message: string }) =>
  c.message.split("\n", 1)[0] ?? "";

/** HEAD and its first-parent ancestors, newest first. */
async function pickCommit(local: LocalRepo): Promise<Commit | undefined> {
  const head = await local.repo.head();
  const commits: Commit[] = [];
  for (let sha = head.sha; sha && commits.length < recentCommitCount;) {
    const commit = await local.repo.readCommit(sha);
    commits.push(commit);
    sha = commit.parents[0];
  }
  if (commits.length === 0) throw new Error("HEAD has no commits yet");
  const picked = await vscode.window.showQuickPick(
    commits.map((commit) => ({
      label: subject(commit),
      description: commit.sha.slice(0, 7),
      detail: `${commit.author.replace(/\s*<.*$/, "")} · ${new Date(commit.time * 1000).toLocaleString()}`,
      commit,
    })),
    {
      placeHolder: "Commit to review against its first parent",
      matchOnDescription: true,
    },
  );
  return picked?.commit;
}

async function pickRef(local: LocalRepo) {
  const refs = (await local.repo.listRefs()).filter((r) => r.kind !== "other");
  const picked = await vscode.window.showQuickPick(
    refs.map((ref) => ({ label: ref.short, description: ref.kind, ref })),
    {
      placeHolder: "Branch or tag to review from where it left HEAD's history",
    },
  );
  return picked?.ref;
}
