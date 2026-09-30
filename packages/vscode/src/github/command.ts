import { createEngine } from "@hihyou/engine";
import { type GitHubHost, githubHost } from "@hihyou/github";
import type { DiffFile } from "@hihyou/ui";
import * as vscode from "vscode";
import { outputChannel } from "../errors.js";
import type { LocalRepos } from "../local/repos.js";
import { openReviewPanel } from "../panel/panel.js";
import { diffFiles, type ReviewSource } from "../review.js";
import { type FoundRemote, githubRemotes } from "./remotes.js";

/** Nothing here talks to GitHub until the command runs and the user has signed in. */
export function githubCommands(
  extensionUri: vscode.Uri,
  repos: LocalRepos,
): Record<string, () => Promise<DiffFile[] | undefined>> {
  return {
    "hihyou.reviewPullRequest": async () => {
      const remote = await pickRemote(await githubRemotes(await repos.all()));
      if (!remote) return undefined;
      const session = await vscode.authentication.getSession(
        "github",
        ["repo"],
        { createIfNone: true },
      );
      const host = githubHost({ token: session.accessToken });
      const number = await pickPullRequest(host, remote);
      if (number === undefined) return undefined;
      const source = await pullRequestSource(host, remote, number);
      return openReviewPanel(extensionUri, source);
    },
  };
}

export async function pullRequestSource(
  host: GitHubHost,
  remote: { owner: string; repo: string },
  number: number,
): Promise<ReviewSource> {
  const pr = await host.resolvePullRequest(remote.owner, remote.repo, number);
  const engine = createEngine(host);
  return {
    title: `#${pr.number} ${pr.title}`,
    load: () =>
      diffFiles(engine, {
        owner: remote.owner,
        repo: remote.repo,
        base: pr.base,
        head: pr.head,
      }),
    readBlob: async (id) => host.readBlob(id),
    refreshable: false,
  };
}

async function pickRemote(
  remotes: FoundRemote[],
): Promise<FoundRemote | undefined> {
  if (remotes.length === 0)
    throw new Error("no git remote in this workspace points at github.com");
  if (remotes.length === 1) return remotes[0];
  const picked = await vscode.window.showQuickPick(
    remotes.map((remote) => ({
      label: `${remote.owner}/${remote.repo}`,
      description: remote.name,
      remote,
    })),
    { placeHolder: "GitHub repository" },
  );
  return picked?.remote;
}

type PullItem = vscode.QuickPickItem & { number: number };

/** Open pull requests to pick from; typing a number (`42` or `#42`) picks any pull request, open or not. */
function pickPullRequest(
  host: GitHubHost,
  remote: FoundRemote,
): Promise<number | undefined> {
  const pick = vscode.window.createQuickPick<PullItem>();
  pick.title = `Pull request in ${remote.owner}/${remote.repo}`;
  pick.placeholder = "Pick an open pull request, or type its number";
  pick.busy = true;
  let listed: PullItem[] = [];
  const typed = (): PullItem[] => {
    const m = /^#?(\d+)$/.exec(pick.value.trim());
    if (!m) return [];
    const number = Number(m[1]);
    if (listed.some((item) => item.number === number)) return [];
    return [
      {
        label: `#${number}`,
        description: "Open by number",
        alwaysShow: true,
        number,
      },
    ];
  };
  const refresh = () => {
    pick.items = [...typed(), ...listed];
  };
  host.listPullRequests(remote.owner, remote.repo).then(
    (prs) => {
      listed = prs.map((pr) => ({
        label: `#${pr.number} ${pr.title}`,
        number: pr.number,
      }));
      pick.busy = false;
      refresh();
    },
    (error: unknown) => {
      pick.busy = false;
      const message = error instanceof Error ? error.message : String(error);
      outputChannel().appendLine(`could not list pull requests: ${message}`);
      pick.placeholder = `Could not list pull requests (${message}); type a number`;
    },
  );
  return new Promise((resolve) => {
    pick.onDidChangeValue(refresh);
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]?.number);
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
      pick.dispose();
    });
    pick.show();
  });
}
