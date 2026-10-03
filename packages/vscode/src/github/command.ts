import { createEngine, type Engine } from "@hihyou/engine";
import {
  type GitHubDiffsetId,
  type GitHubHost,
  type GitHubPullRequest,
  githubHost,
} from "@hihyou/github";
import { type DiffFile, engineReview, type ReviewSource } from "@hihyou/ui";
import * as vscode from "vscode";
import { setCurrentDiffsets } from "../diffsets/current.js";
import { outputChannel } from "../errors.js";
import type { LocalRepos } from "../local/repos.js";
import { openReviewPanel } from "../panel/panel.js";
import { parsePullRef, pullRefHint, remotesFor } from "./pull-ref.js";
import { type FoundRemote, githubRemotes } from "./remotes.js";

/** A pull request the user opened, which the diffsets view lists with its commits. */
export interface OpenedPullRequest {
  host: GitHubHost;
  remote: { owner: string; repo: string };
  pr: GitHubPullRequest;
}

/** A pull request of one of the workspace's GitHub remotes. */
interface PullTarget {
  owner: string;
  repo: string;
  number: number;
}

/** A recently opened pull request, kept in `globalState` so a case reopens in one keystroke; never the token. */
interface Recent extends PullTarget {
  title: string;
}

const recentKey = "hihyou.recentPullRequests";
const recentLimit = 20;

/** Nothing here talks to GitHub until the command runs and the user has signed in. */
export function githubCommands(
  context: vscode.ExtensionContext,
  repos: LocalRepos,
): Record<string, () => Promise<DiffFile[] | undefined>> {
  const recents = () => context.globalState.get<Recent[]>(recentKey) ?? [];
  return {
    "hihyou.reviewPullRequest": async () => {
      const remotes = await githubRemotes(await repos.all());
      if (remotes.length === 0)
        throw new Error("no git remote in this workspace points at github.com");
      const host = await signedInHost();
      const target = await pickPullRequest(host, remotes, recents());
      if (!target) return undefined;
      const { owner, repo, number } = target;
      const { pr, files } = await openPullRequest(
        context.extensionUri,
        host,
        { owner, repo },
        number,
      );
      const opened: Recent = {
        owner,
        repo,
        number: pr.number,
        title: pr.title,
      };
      await context.globalState.update(
        recentKey,
        [
          opened,
          ...recents().filter((r) => refKey(r) !== refKey(opened)),
        ].slice(0, recentLimit),
      );
      return files;
    },
  };
}

const refLabel = ({ owner, repo, number }: PullTarget) =>
  `${owner}/${repo}#${number}`;
const refKey = (target: PullTarget) => refLabel(target).toLowerCase();

/** The token lives only in this host object, never in storage or logs. */
export async function signedInHost(): Promise<GitHubHost> {
  const session = await vscode.authentication.getSession("github", ["repo"], {
    createIfNone: true,
  });
  return githubHost({ token: session.accessToken });
}

/** Resolves a pull request, makes it the diffsets view's current set, and opens its review panel. */
export async function openPullRequest(
  extensionUri: vscode.Uri,
  host: GitHubHost,
  remote: { owner: string; repo: string },
  number: number,
): Promise<{ pr: GitHubPullRequest; files: DiffFile[] | undefined }> {
  const pr = await host.resolvePullRequest(remote.owner, remote.repo, number);
  setCurrentDiffsets({ kind: "github", opened: { host, remote, pr } });
  const files = await openReviewPanel(
    extensionUri,
    githubSource(
      host,
      { ...remote, base: pr.base, head: pr.head },
      `#${pr.number} ${pr.title}`,
      pr.number,
    ),
  );
  return { pr, files };
}

/** One engine per host, so the diffsets view's file listing and the panel share a resolved compare. */
const engines = new WeakMap<GitHubHost, Engine<GitHubHost>>();
export function githubEngine(host: GitHubHost): Engine<GitHubHost> {
  let engine = engines.get(host);
  if (!engine) engines.set(host, (engine = createEngine(host)));
  return engine;
}

/** `pull` is the pull request whose whole change `id` is; its comments then go to GitHub. A single commit's do not, as GitHub places them on the pull request's diff. */
export function githubSource(
  host: GitHubHost,
  id: GitHubDiffsetId,
  title: string,
  pull?: number,
): ReviewSource {
  const engine = githubEngine(host);
  return {
    title,
    ...engineReview(engine, () => id),
    refreshable: false,
    ...(pull !== undefined && {
      comments: () =>
        host.reviewComments(
          { ...id, number: pull },
          async (anchor) =>
            (await engine.diffset(id)).anchor(anchor).intoLineRanges(),
          async (side, path, lines) =>
            (await engine.diffset(id)).anchorOnLines(side, path, lines),
          async () => (await engine.diffset(id)).changes,
        ),
    }),
  };
}

type PullItem = vscode.QuickPickItem & { target?: PullTarget };

const sameTarget = (a: PullTarget, b: PullTarget) => refKey(a) === refKey(b);

/**
 * The remotes' open pull requests, after the recently opened ones of the same remotes. Typed text filters them;
 * a number, URL or `owner/repo#n` narrows to that pull request, offering it by number when it is not listed
 * (closed or merged). Resolves on an item that names a pull request.
 */
function pickPullRequest(
  host: GitHubHost,
  remotes: readonly FoundRemote[],
  recent: readonly Recent[],
): Promise<PullTarget | undefined> {
  const pick = vscode.window.createQuickPick<PullItem>();
  pick.title = "Review GitHub pull request";
  pick.placeholder = pullRefHint;
  pick.matchOnDescription = true;
  pick.busy = true;
  const separator = (label: string): PullItem => ({
    label,
    kind: vscode.QuickPickItemKind.Separator,
  });
  const inWorkspace = recent.filter((r) => remotesFor(r, remotes).length > 0);
  const recentItems: PullItem[] = inWorkspace.map((r) => ({
    label: `#${r.number} ${r.title}`,
    description: `${r.owner}/${r.repo}`,
    target: r,
  }));
  let listed: PullItem[][] = [];
  const all = (): PullItem[] => [
    ...(recentItems.length > 0 ? [separator("Recent"), ...recentItems] : []),
    ...listed.flat(),
  ];
  /** The items a typed reference picks out, or `undefined` when the text is a plain search. */
  const narrowed = (value: string): PullItem[] | undefined => {
    const ref = parsePullRef(value);
    if (!ref) return undefined;
    const matched = remotesFor(ref, remotes);
    if (matched.length === 0)
      return [
        {
          label: `$(error) ${ref.owner}/${ref.repo} is not a GitHub remote of this workspace`,
          alwaysShow: true,
        },
      ];
    const items = all().filter((item) => item.target);
    return matched.map((remote) => {
      const target = {
        owner: remote.owner,
        repo: remote.repo,
        number: ref.number,
      };
      const known = items.find(
        (item) => item.target && sameTarget(item.target, target),
      );
      return known
        ? { ...known, alwaysShow: true }
        : {
            label: `Open #${ref.number}`,
            description: `${remote.owner}/${remote.repo}`,
            alwaysShow: true,
            target,
          };
    });
  };
  const refresh = () => {
    pick.items = narrowed(pick.value.trim()) ?? all();
  };
  Promise.all(
    remotes.map(async (remote) => {
      const prs = await host.listPullRequests(remote.owner, remote.repo);
      return prs.length === 0
        ? []
        : [
            separator(`Open in ${remote.owner}/${remote.repo}`),
            ...prs.map((pr) => ({
              label: `#${pr.number} ${pr.title}`,
              description: `${remote.owner}/${remote.repo}`,
              target: {
                owner: remote.owner,
                repo: remote.repo,
                number: pr.number,
              },
            })),
          ];
    }),
  ).then(
    (groups) => {
      listed = groups;
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
  refresh();
  return new Promise((resolve) => {
    pick.onDidChangeValue(refresh);
    pick.onDidAccept(() => {
      const target = pick.selectedItems[0]?.target;
      // Accepting an error row keeps the pick open so the text can be fixed.
      if (!target) return;
      resolve(target);
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
      pick.dispose();
    });
    pick.show();
  });
}
