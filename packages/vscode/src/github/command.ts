import { createEngine, type Engine } from "@hihyou/engine";
import {
  type GitHubDiffsetId,
  type GitHubHost,
  type GitHubPullRequest,
  githubHost,
} from "@hihyou/github";
import type { DiffFile } from "@hihyou/ui";
import * as vscode from "vscode";
import { outputChannel } from "../errors.js";
import type { LocalRepos } from "../local/repos.js";
import { openReviewPanel } from "../panel/panel.js";
import { diffFiles, type ReviewSource } from "../review.js";
import { type FoundRemote, githubRemotes } from "./remotes.js";

/** A pull request the user opened, which the diffsets view lists with its commits. */
export interface OpenedPullRequest {
  host: GitHubHost;
  remote: { owner: string; repo: string };
  pr: GitHubPullRequest;
}

/** Nothing here talks to GitHub until the command runs and the user has signed in. */
export function githubCommands(
  extensionUri: vscode.Uri,
  repos: LocalRepos,
  onPullRequest: (opened: OpenedPullRequest) => void,
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
      const pr = await host.resolvePullRequest(
        remote.owner,
        remote.repo,
        number,
      );
      onPullRequest({ host, remote, pr });
      return openReviewPanel(
        extensionUri,
        githubSource(
          host,
          { ...remote, base: pr.base, head: pr.head },
          `#${pr.number} ${pr.title}`,
        ),
      );
    },
  };
}

/** One engine per host, so the diffsets view's file listing and the panel share a resolved compare. */
const engines = new WeakMap<GitHubHost, Engine<GitHubHost>>();
export function githubEngine(host: GitHubHost): Engine<GitHubHost> {
  let engine = engines.get(host);
  if (!engine) engines.set(host, (engine = createEngine(host)));
  return engine;
}

export function githubSource(
  host: GitHubHost,
  id: GitHubDiffsetId,
  title: string,
): ReviewSource {
  return {
    title,
    load: () => diffFiles(githubEngine(host), id),
    readBlob: async (blob) => host.readBlob(blob),
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
